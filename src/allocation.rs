//! 面积图把共享空间归入首次见到的名称；清理估算独立核对所选名称能否覆盖全部硬链接。
use crate::{
    catalog::{open_entry, Catalog, Stamp},
    cleanup,
};
use file_id::FileId;
use serde::Serialize;
use std::{
    cell::OnceCell,
    collections::{HashMap, HashSet},
    fs::File,
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
use winsafe::{self as w, co, prelude::*};

#[derive(Clone, Copy, Default, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct Disk {
    /// 文件自身的数据占用；目录保存去重后的子树合计。
    pub bytes: u64,
    /// 面积图归属此名称的字节数。
    pub charged: u64,
    pub unknown: u64,
}

impl Disk {
    pub fn add(&mut self, child: Self) {
        self.charged += child.charged;
        self.bytes = self.charged;
        self.unknown += child.unknown;
    }
}

pub struct Measurement {
    bytes: u64,
    links: u64,
    shared_id: Option<FileId>,
}

pub struct Reader {
    ntfs_unit: Option<u64>,
    apartment: OnceCell<w::HrResult<w::guard::CoUninitializeGuard>>,
}

impl Reader {
    pub fn new(root: &Path) -> Self {
        // 扫描不会跨越重解析点，同一次遍历只需查询一次卷属性。
        let ntfs_unit = (|| {
            let volume = root.ancestors().last()?.to_str()?;
            let mut system = String::new();
            w::GetVolumeInformation(Some(volume), None, None, None, None, Some(&mut system))
                .ok()?;
            if system != "NTFS" {
                return None;
            }
            fs2::allocation_granularity(root).ok()
        })();
        Self {
            ntfs_unit,
            apartment: OnceCell::new(),
        }
    }

    fn data_bytes(&self, path: &Path, raw: u64, eof: u64) -> io::Result<u64> {
        if raw == 0 || raw >= 65536 || (raw != eof && raw != eof.next_multiple_of(8)) {
            return Ok(raw);
        }
        // NTFS 驻留数据的标准分配长度可为 8 字节对齐的记录内长度；它没有独立数据簇。
        if self.ntfs_unit.is_some_and(|unit| raw < unit) {
            return Ok(0);
        }
        // 簇与记录内长度可能恰好相同，请 Shell 区分实际驻留与已分配的小文件。
        self.apartment
            .get_or_init(|| w::CoInitializeEx(co::COINIT::MULTITHREADED))
            .as_ref()
            .map_err(|e| io::Error::other(e.to_string()))?;
        let name = path
            .to_str()
            .ok_or_else(|| io::Error::other("Shell 无法表示此文件名"))?;
        let item = w::SHCreateItemFromParsingName::<w::IShellItem2>(name, None::<&w::IBindCtx>)
            .map_err(io::Error::other)?;
        item.GetUInt64(&co::PKEY::FileAllocationSize)
            .map_err(io::Error::other)
    }

    pub fn read(&self, path: &Path, handle: &File, expected: Stamp) -> io::Result<Measurement> {
        let info = winapi_util::file::information(handle)?;
        if !expected.matches_file(&info) || info.number_of_links() == 0 {
            return Err(io::Error::other("文件属性已变化或链接数不可用"));
        }
        // 普通文件读取实际分配长度，避免按逻辑长度或簇大小推算驻留数据和预分配空间。
        let bytes = if expected.attrs & (0x0200 | 0x0800) != 0 {
            filesize::file_real_size(path)?
        } else {
            fs2::FileExt::allocated_size(handle)?
        };
        let links = info.number_of_links();
        let shared_id = if links > 1 {
            Some(file_id::get_high_res_file_id(path)?)
        } else {
            None
        };
        Ok(Measurement {
            bytes: self.data_bytes(path, bytes, info.file_size())?,
            links,
            shared_id,
        })
    }
}

impl Measurement {
    pub fn attribute(self, seen: &mut HashSet<FileId>) -> Disk {
        let first = self.shared_id.is_none_or(|id| seen.insert(id));
        Disk {
            bytes: self.bytes,
            charged: if first { self.bytes } else { 0 },
            unknown: 0,
        }
    }
}

#[derive(Default, Serialize)]
pub struct Estimate {
    blocked: Vec<crate::cleanup::Outcome>,
    reclaimable: u64,
    retained: u64,
    retained_files: u64,
    unknown: u64,
}

struct LinkGroup {
    bytes: u64,
    total: u64,
    selected: u64,
    consistent: bool,
}

/// 重新查询实时链接计数，扫描范围外的链接以及扫描后新增的链接也会影响结果。
pub fn estimate(
    catalog: &Catalog,
    paths: &[PathBuf],
    cancel: &AtomicBool,
) -> Result<Estimate, String> {
    cleanup::check_selection(paths)?;
    let mut estimate = Estimate::default();
    let mut shared = HashMap::<FileId, LinkGroup>::new();
    let mut folders = Vec::new();
    let reader = Reader::new(&catalog.root);
    let mut measure = |path: &Path, stamp| match open_entry(path)
        .and_then(|handle| reader.read(path, &handle, stamp))
    {
        Ok(Measurement {
            bytes,
            shared_id: None,
            ..
        }) => estimate.reclaimable += bytes,
        Ok(Measurement {
            bytes,
            links,
            shared_id: Some(id),
        }) => {
            let group = shared.entry(id).or_insert(LinkGroup {
                bytes,
                total: links,
                selected: 0,
                consistent: true,
            });
            group.consistent &= group.total == links && group.bytes == bytes;
            group.selected += 1;
        }
        Err(_) => estimate.unknown += 1,
    };
    for path in paths {
        if cancel.load(Ordering::Relaxed) {
            return Err("估算已取消。".into());
        }
        if let Err(reason) = cleanup::stage(catalog, path) {
            estimate.blocked.push(crate::cleanup::Outcome {
                path: path.clone(),
                error: Some(reason),
            });
            continue;
        }
        let entry = catalog.member(path)?;
        if entry.directory() {
            folders.push((path.clone(), entry.stamp));
        } else {
            measure(path, entry.stamp);
        }
    }
    while let Some((dir, expected)) = folders.pop() {
        if cancel.load(Ordering::Relaxed) {
            return Err("估算已取消。".into());
        }
        let meta = open_entry(&dir)
            .and_then(|f| f.metadata())
            .map_err(|e| format!("{} — {e}", dir.display()))?;
        if Stamp::read(&meta) != expected {
            return Err(format!("目录已变化，请重新扫描：{}", dir.display()));
        }
        for entry in &catalog.branch(&dir)?.members {
            if cancel.load(Ordering::Relaxed) {
                return Err("估算已取消。".into());
            }
            let path = dir.join(&entry.name);
            if entry.directory() {
                folders.push((path, entry.stamp));
            } else {
                measure(&path, entry.stamp);
            }
        }
    }
    for group in shared.into_values() {
        if !group.consistent || group.selected > group.total {
            estimate.unknown += group.selected;
        } else if group.selected == group.total {
            estimate.reclaimable += group.bytes;
        } else {
            estimate.retained += group.bytes;
            estimate.retained_files += 1;
        }
    }
    Ok(estimate)
}
