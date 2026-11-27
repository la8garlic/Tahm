//! 清理只接受当前快照中的本机条目。每项交给 Windows 回收站前，再核对目录内容。

use crate::{
    catalog::{open_entry, Catalog, Stamp},
    scan,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf, Prefix},
    time::{Duration, Instant},
};

fn local_disk(path: &Path) -> bool {
    matches!(path.components().next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
}

fn check_scope(catalog: &Catalog, path: &Path) -> Result<(), String> {
    if path == catalog.root || !path.starts_with(&catalog.root) || !local_disk(path) {
        return Err("请选择本机扫描范围内的子项目，扫描起点不能回收。".into());
    }
    scan::checked_root(path)?;
    let real = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !local_disk(&real) {
        return Err("网络位置不支持本机回收站。".into());
    }
    // Shell 会规范化某些 NTFS 名称，拒绝可能解析成另一个对象的路径。
    for part in path.components() {
        if let Component::Normal(name) = part {
            let name = name.to_str().ok_or("名称不能由 Shell 无损表示。")?;
            if name.ends_with(['.', ' ']) || name.contains([':', '\u{fffd}']) {
                return Err("此名称不适合通过 Windows Shell 回收。".into());
            }
        }
    }
    let lowercase = |p: &Path| PathBuf::from(p.to_string_lossy().to_lowercase());
    let normalized = lowercase(&real);
    for var in [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "ProgramData",
    ] {
        if let Some(base) = env::var_os(var) {
            if let Ok(base) = fs::canonicalize(base) {
                let base = lowercase(&base);
                if normalized.starts_with(&base) || base.starts_with(&normalized) {
                    return Err("系统或应用安装目录由 Windows 管理。".into());
                }
            }
        }
    }
    for keep in [
        dirs::home_dir(),
        dirs::desktop_dir(),
        dirs::download_dir(),
        dirs::document_dir(),
        dirs::data_dir(),
        dirs::data_local_dir(),
        env::current_exe().ok(),
    ]
    .into_iter()
    .flatten()
    {
        if let Ok(keep) = fs::canonicalize(keep) {
            if lowercase(&keep).starts_with(&normalized) {
                return Err("此位置包含用户主目录、系统资料目录或正在运行的塔姆。".into());
            }
        }
    }
    if real.components().any(|p| {
        matches!(
            p.as_os_str()
                .to_string_lossy()
                .to_ascii_lowercase()
                .as_str(),
            "$recycle.bin" | "system volume information" | ".git" | ".svn"
        )
    }) {
        return Err("此处由系统或版本控制工具管理。".into());
    }
    Ok(())
}

pub fn stage(catalog: &Catalog, path: &Path) -> Result<(), String> {
    check_scope(catalog, path)?;
    let row = catalog.member(path)?;
    row.stamp.verify(current_stamp(path)?, path)?;
    if row.stamp.attrs & 0x404 != 0 {
        return Err("系统项或重解析点不能加入清单。".into());
    }
    if row.directory() && !catalog.branch(path)?.complete {
        return Err("目录包含未读或跳过的条目，请进入目录逐项复核。".into());
    }
    Ok(())
}

fn current_stamp(path: &Path) -> Result<Stamp, String> {
    let meta = open_entry(path)
        .and_then(|f| f.metadata())
        .map_err(|e| format!("无法复核 {}：{e}", path.display()))?;
    Ok(Stamp::read(&meta))
}

fn recheck_contents(
    catalog: &Catalog,
    root: &Path,
    mut visit: impl FnMut(&Path, bool) -> Result<(), String>,
) -> Result<(), String> {
    let mut pending = vec![root.to_owned()];
    while let Some(dir) = pending.pop() {
        let branch = catalog.branch(&dir)?;
        let mut expected: HashMap<&OsStr, Stamp> = branch
            .members
            .iter()
            .map(|m| (m.name.as_os_str(), m.stamp))
            .collect();
        for result in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = result.map_err(|e| e.to_string())?;
            let path = entry.path();
            let original = expected
                .remove(entry.file_name().as_os_str())
                .ok_or_else(|| format!("扫描后新增了条目：{}", path.display()))?;
            original.verify(current_stamp(&path)?, &path)?;
            let directory = original.attrs & 0x10 != 0;
            visit(&path, !directory)?;
            if directory {
                pending.push(path);
            }
        }
        if let Some(name) = expected.keys().next() {
            return Err(format!(
                "扫描后条目已移出或改名：{}",
                dir.join(name).display()
            ));
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Outcome {
    pub path: PathBuf,
    pub error: Option<String>,
}

pub fn check_selection(paths: &[PathBuf]) -> Result<(), String> {
    let unique: HashSet<&Path> = paths.iter().map(PathBuf::as_path).collect();
    if paths.is_empty()
        || paths.len() != unique.len()
        || paths
            .iter()
            .any(|p| p.ancestors().skip(1).any(|a| unique.contains(a)))
    {
        return Err("清单为空或包含重复及嵌套项目，请重新选择。".into());
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Verify,
    Shell,
}

#[derive(Serialize)]
pub struct Progress {
    index: usize,
    total: usize,
    phase: Phase,
    path: PathBuf,
    checked: u64,
    files: u64,
}

pub fn recycle(
    catalog: &Catalog,
    paths: Vec<PathBuf>,
    mut update: impl FnMut(Progress) -> Result<(), String>,
) -> Result<Vec<Outcome>, String> {
    check_selection(&paths)?;
    let total = paths.len();
    Ok(paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| {
            let result = (|| {
                let dir = catalog.branches.get(&path);
                let files = dir.map_or(1, |d| d.info.files);
                let mut publish = |phase, checked, path: &Path| {
                    update(Progress {
                        index: index + 1,
                        total,
                        phase,
                        path: path.to_owned(),
                        checked,
                        files,
                    })
                };
                publish(Phase::Verify, 0, &path)?;
                stage(catalog, &path)?;
                if dir.is_some() {
                    let mut checked = 0;
                    let mut tick = Instant::now();
                    recheck_contents(catalog, &path, |current, file| {
                        checked += u64::from(file);
                        if tick.elapsed() >= Duration::from_millis(120) {
                            publish(Phase::Verify, checked, current)?;
                            tick = Instant::now();
                        }
                        Ok(())
                    })?;
                    // 大目录核对可能耗时，再确认 Shell 即将接收的顶层路径。
                    stage(catalog, &path)?;
                }
                publish(Phase::Shell, files, &path)?;
                // trash 的 Windows 实现使用 Shell 回收操作并报告被跳过的项目。
                trash::delete(&path).map_err(|e| format!("Windows 回收失败：{e}"))
            })();
            Outcome {
                path,
                error: result.err(),
            }
        })
        .collect())
}
