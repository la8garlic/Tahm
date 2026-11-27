//! 桌面边界只开放目录分析、定位与用户指定的报告导出。

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use serde::Serialize;
use tauri::{ipc::Channel, State};

use crate::{
    catalog::{Catalog, Page},
    cleanup,
    report::Report,
    scan,
};

#[derive(Default)]
pub struct Session(Mutex<Desk>);

#[derive(Default)]
struct Desk {
    estimates: std::collections::HashMap<String, Arc<AtomicBool>>,
    scan: Option<Arc<AtomicBool>>,
    compare: Option<Arc<AtomicBool>>,
    catalog: Option<Arc<Catalog>>,
    generation: u64,
    recycling: bool,
}

impl Desk {
    fn snapshot(&self, generation: u64) -> Result<Arc<Catalog>, String> {
        if self.generation != generation {
            return Err("扫描结果已更新，请重新选择。".into());
        }
        self.catalog.clone().ok_or_else(|| "请先完成扫描。".into())
    }
}

#[derive(Serialize)]
pub struct Progress {
    files: u64,
    folders: u64,
    bytes: u64,
    path: String,
}

/// 支持将目录拖到可执行文件上，或通过命令行指定起始目录。
#[tauri::command]
pub fn initial_folder() -> Option<PathBuf> {
    std::env::args_os().nth(1).map(PathBuf::from)
}

/// 常用扫描位置由系统提供，允许桌面和下载目录重定向。
#[tauri::command]
pub fn locations() -> Vec<(&'static str, PathBuf)> {
    [
        ("下载", dirs::download_dir()),
        ("桌面", dirs::desktop_dir()),
        ("个人目录", dirs::home_dir()),
    ]
    .into_iter()
    .filter_map(|(label, path)| path.map(|p| (label, p)))
    .collect()
}

#[derive(Serialize)]
pub struct Volume {
    path: PathBuf,
    label: String,
    total: u64,
    free: u64,
}

/// 仅读取卷容量；扫描文件由用户单独发起。
#[tauri::command]
pub async fn volumes() -> Result<Vec<Volume>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let disks = sysinfo::Disks::new_with_refreshed_list_specifics(
            sysinfo::DiskRefreshKind::nothing().with_storage(),
        )
        .map_err(|e| e.to_string())?;
        Ok(disks
            .iter()
            .map(|d| Volume {
                path: d.mount_point().to_owned(),
                label: d.name().to_string_lossy().into_owned(),
                total: d.total_space(),
                free: d.available_space(),
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 目录分页仅查询已完成的扫描；耗时筛选放在工作线程。
#[tauri::command]
pub async fn folder_page(
    path: PathBuf,
    generation: u64,
    query: String,
    viewport: crate::catalog::Viewport,
    session: State<'_, Session>,
) -> Result<Page, String> {
    let catalog = session
        .0
        .lock()
        .expect("扫描状态锁已损坏")
        .snapshot(generation)?;
    tauri::async_runtime::spawn_blocking(move || catalog.page(&path, &query, viewport))
        .await
        .map_err(|e| e.to_string())?
}

/// 图与表可独立定位；点击预览中的子项时仍保留原图。
#[tauri::command]
pub async fn map_page(
    path: PathBuf,
    generation: u64,
    viewport: crate::catalog::Viewport,
    session: State<'_, Session>,
) -> Result<crate::catalog::MapPage, String> {
    let catalog = session
        .0
        .lock()
        .expect("扫描状态锁已损坏")
        .snapshot(generation)?;
    tauri::async_runtime::spawn_blocking(move || catalog.map_page(&path, viewport))
        .await
        .map_err(|e| e.to_string())?
}

/// 在当前快照的所有目录中查找符合条件的文件。
#[tauri::command]
pub async fn find_files(
    generation: u64,
    query: String,
    extension: Option<String>,
    minimum: u64,
    after: Option<crate::catalog::FileCursor>,
    session: State<'_, Session>,
) -> Result<(usize, Vec<crate::report::Item>), String> {
    let catalog = session
        .0
        .lock()
        .expect("扫描状态锁已损坏")
        .snapshot(generation)?;
    tauri::async_runtime::spawn_blocking(move || {
        catalog.find_files(&query, extension.as_deref(), minimum, after.as_ref())
    })
    .await
    .map_err(|e| e.to_string())
}

/// 沿当前筛选与排序读取跨页选择范围。
#[tauri::command]
pub async fn selection_range(
    generation: u64,
    order: crate::catalog::SelectionOrder,
    start: PathBuf,
    end: PathBuf,
    session: State<'_, Session>,
) -> Result<Vec<crate::report::Item>, String> {
    let catalog = session
        .0
        .lock()
        .expect("扫描状态锁已损坏")
        .snapshot(generation)?;
    tauri::async_runtime::spawn_blocking(move || catalog.selection_range(order, &start, &end))
        .await
        .map_err(|e| e.to_string())?
}

/// 按需比对一个文件，在磁盘工作线程读取内容并汇报进度。
#[tauri::command]
pub async fn find_copies(
    generation: u64,
    path: PathBuf,
    updates: Channel<crate::copies::Progress>,
    session: State<'_, Session>,
) -> Result<crate::copies::Copies, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let catalog = {
        let mut desk = session.0.lock().expect("扫描状态锁已损坏");
        if desk.compare.is_some() || desk.scan.is_some() || desk.recycling {
            return Err("请等待当前磁盘操作完成。".into());
        }
        let catalog = desk.snapshot(generation)?;
        desk.compare = Some(Arc::clone(&cancel));
        catalog
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::copies::find(&catalog, &path, &cancel, |progress| {
            updates.send(progress.clone()).map_err(|e| e.to_string())
        })
    })
    .await;
    session.0.lock().expect("扫描状态锁已损坏").compare = None;
    result.map_err(|e| e.to_string())?
}

/// 让比较线程在当前数据块结束后释放文件句柄。
#[tauri::command]
pub fn cancel_copies(session: State<'_, Session>) {
    if let Some(cancel) = &session.0.lock().expect("扫描状态锁已损坏").compare {
        cancel.store(true, Ordering::Relaxed);
    }
}

/// 从快照按最近文件写入日期查找完整的旧目录。
#[tauri::command]
pub async fn old_folders(
    generation: u64,
    before: u64,
    minimum: u64,
    query: String,
    session: State<'_, Session>,
) -> Result<(usize, Vec<crate::report::Item>), String> {
    let catalog = session
        .0
        .lock()
        .expect("扫描状态锁已损坏")
        .snapshot(generation)?;
    tauri::async_runtime::spawn_blocking(move || catalog.old_folders(before, minimum, &query))
        .await
        .map_err(|e| e.to_string())
}

/// 只估算清单中项目的数据释放量，不操作系统回收站。
#[tauri::command]
pub async fn estimate_reclaim(
    generation: u64,
    ticket: String,
    paths: Vec<PathBuf>,
    session: State<'_, Session>,
) -> Result<crate::allocation::Estimate, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let catalog = {
        let mut desk = session.0.lock().expect("扫描状态锁已损坏");
        if desk.recycling || desk.scan.is_some() {
            return Err("请等待当前磁盘操作完成。".into());
        }
        let snapshot = desk.snapshot(generation)?;
        // 选区和清单可同时显示，各自持有可取消的请求。
        desk.estimates.insert(ticket.clone(), Arc::clone(&cancel));
        snapshot
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::allocation::estimate(&catalog, &paths, &cancel)
    })
    .await;
    let mut desk = session.0.lock().expect("扫描状态锁已损坏");
    desk.estimates.remove(&ticket);
    result.map_err(|e| e.to_string())?
}

/// 关闭清单或改变选择时，只取消对应的估算，不干扰后续请求。
#[tauri::command]
pub fn cancel_estimate(ticket: String, session: State<'_, Session>) {
    if let Some(stop) = session
        .0
        .lock()
        .expect("扫描状态锁已损坏")
        .estimates
        .get(&ticket)
    {
        stop.store(true, Ordering::Relaxed);
    }
}

/// 入队时核对目录范围与文件属性，实际执行时再次检查。
#[tauri::command]
pub async fn check_candidates(
    paths: Vec<PathBuf>,
    generation: u64,
    session: State<'_, Session>,
) -> Result<Vec<cleanup::Outcome>, String> {
    let catalog = session
        .0
        .lock()
        .expect("扫描状态锁已损坏")
        .snapshot(generation)?;
    tauri::async_runtime::spawn_blocking(move || {
        cleanup::check_selection(&paths)?;
        Ok(paths
            .into_iter()
            .map(|path| {
                let error = cleanup::stage(&catalog, &path).err();
                cleanup::Outcome { path, error }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 每一项单独报告 Shell 执行结果，部分成功后使旧快照失效。
#[tauri::command]
pub async fn recycle_items(
    paths: Vec<PathBuf>,
    generation: u64,
    updates: Channel<cleanup::Progress>,
    session: State<'_, Session>,
) -> Result<Vec<cleanup::Outcome>, String> {
    let catalog = {
        let mut desk = session.0.lock().expect("扫描状态锁已损坏");
        if desk.scan.is_some() || desk.compare.is_some() || desk.recycling {
            return Err("请等待当前磁盘操作完成。".into());
        }
        let catalog = desk.snapshot(generation)?;
        desk.recycling = true;
        catalog
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        cleanup::recycle(&catalog, paths, |p| {
            updates.send(p).map_err(|e| e.to_string())
        })
    })
    .await;
    let mut desk = session.0.lock().expect("扫描状态锁已损坏");
    desk.recycling = false;
    let outcomes = result.map_err(|e| e.to_string())??;
    if outcomes.iter().any(|o| o.error.is_none()) {
        desk.catalog = None;
    }
    Ok(outcomes)
}

/// 交给 Windows 展示回收站，使用系统原生还原操作。
#[tauri::command]
pub fn open_recycle_bin() -> Result<(), String> {
    let system = std::env::var_os("SystemRoot").ok_or("找不到 Windows 系统目录。")?;
    Command::new(Path::new(&system).join("explorer.exe"))
        .arg("shell:RecycleBinFolder")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 选择器返回空值代表使用者取消。
#[tauri::command]
pub async fn choose_folder(english: bool) -> Result<Option<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title(if english {
                "Choose a folder or drive to scan"
            } else {
                "选择要分析的文件夹或磁盘"
            })
            .pick_folder()
    })
    .await
    .map_err(|err| err.to_string())
}

/// 同时只允许一次磁盘遍历，阻塞枚举在工作线程执行。
#[tauri::command]
pub async fn analyze(
    path: PathBuf,
    updates: Channel<Progress>,
    session: State<'_, Session>,
) -> Result<Option<Report>, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = session.0.lock().expect("扫描状态锁已损坏");
        if active.scan.is_some() || active.compare.is_some() || active.recycling {
            return Err("已有分析正在运行。".into());
        }
        active.scan = Some(Arc::clone(&cancel));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        scan::run(&path, &cancel, |counts, path| {
            updates
                .send(Progress {
                    files: counts.files,
                    folders: counts.folders,
                    bytes: counts.bytes,
                    path: path.display().to_string(),
                })
                .map_err(|err| err.to_string())
        })
    })
    .await;
    let mut desk = session.0.lock().expect("扫描状态锁已损坏");
    desk.scan = None;
    Ok(result
        .map_err(|err| err.to_string())??
        .map(|(mut report, catalog)| {
            desk.generation += 1;
            report.generation = desk.generation;
            desk.catalog = Some(Arc::new(catalog));
            report
        }))
}

/// 本地读取目录名称样本，供发送前预览。
#[tauri::command]
pub async fn directory_sample(path: PathBuf) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::model::sample(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// 仅发送用户在解读面板中确认的线索。
#[tauri::command]
pub async fn explain_directory(
    settings: crate::model::Settings,
    facts: Vec<String>,
    english: bool,
) -> Result<crate::model::Assessment, String> {
    crate::model::explain(settings, facts, english).await
}

/// 只停止当前扫描，界面可继续浏览上一份完整报告。
#[tauri::command]
pub fn cancel_scan(session: State<'_, Session>) {
    if let Some(cancel) = session.0.lock().expect("扫描状态锁已损坏").scan.as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
}

/// 仅打开磁盘上的目录，始终通过资源管理器定位，避免执行扫描到的文件。
#[tauri::command]
pub async fn open_folder(path: PathBuf) -> Result<(), String> {
    if !path.is_absolute() || !fs::metadata(&path).map_err(|e| e.to_string())?.is_dir() {
        return Err("目标必须是现存目录。".into());
    }
    let windows = std::env::var_os("SystemRoot").ok_or("找不到 Windows 系统目录。")?;
    Command::new(Path::new(&windows).join("explorer.exe"))
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

/// 报告含本地路径，保存位置由使用者在系统对话框中指定。
#[tauri::command]
pub async fn export_report(json: String, english: bool) -> Result<Option<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_title(if english {
                "Save scan report"
            } else {
                "保存分析报告"
            })
            .add_filter(
                if english {
                    "JSON report"
                } else {
                    "JSON 报告"
                },
                &["json"],
            )
            .set_file_name(if english {
                "Tahm-Space-Report.json"
            } else {
                "塔姆-空间报告.json"
            })
            .save_file();
        if let Some(ref destination) = path {
            let parent = destination.parent().ok_or("报告路径缺少父目录。")?;
            // 完整落盘后再替换，磁盘已满时仍保留原来的报告。
            let save = || -> std::io::Result<()> {
                let mut staging = tempfile::NamedTempFile::new_in(parent)?;
                staging.write_all(json.as_bytes())?;
                staging.as_file().sync_all()?;
                staging.persist(destination)?;
                Ok(())
            };
            save().map_err(|err| format!("{} — {err}", destination.display()))?;
        }
        Ok(path)
    })
    .await
    .map_err(|err| err.to_string())?
}
