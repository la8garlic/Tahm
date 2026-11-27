//! 深度优先枚举目录，退栈时合并子树统计。每个目录只枚举一次。

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, ReadDir},
    io,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use crate::{
    advice::{self, Markers, KINDS},
    allocation::{Disk, Measurement, Reader},
    catalog::{open_entry, Branch, Catalog, Member, Stamp},
    report::{display, Extension, Item, Ranking, Report, Totals},
};

const REPARSE: u32 = 0x400;

struct Frame {
    disk: Disk,
    members: Vec<Member>,
    stamp: Stamp,
    path: PathBuf,
    entries: ReadDir,
    name: String,
    guarded: bool,
    generated: bool,
    within_generated: bool,
    markers: Markers,
    types: [u64; KINDS.len()],
    files: u64,
    modified: Option<u64>,
    incomplete: bool,
}

impl Frame {
    fn open(
        path: PathBuf,
        guarded: bool,
        within_generated: bool,
        stamp: Stamp,
    ) -> io::Result<Self> {
        if stamp.attrs & (0x10 | REPARSE) != 0x10 {
            return Err(io::Error::other("目录已变化或为重解析点。"));
        }
        let entries = fs::read_dir(&path)?;
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        Ok(Self {
            disk: Disk::default(),
            members: Vec::new(),
            stamp,
            generated: within_generated || advice::generated_name(&name),
            guarded: guarded || advice::protected(&name),
            entries,
            path,
            name,
            within_generated,
            markers: Markers::default(),
            types: [0; KINDS.len()],
            files: 0,
            modified: None,
            incomplete: false,
        })
    }

    fn absorb(&mut self, child: &Frame) {
        self.disk.add(child.disk);
        for (total, part) in self.types.iter_mut().zip(child.types) {
            *total += part;
        }
        self.files += child.files;
        self.modified = self.modified.max(child.modified);
        self.incomplete |= child.incomplete;
    }

    fn item(&self) -> Item {
        let bytes = self.types.iter().sum();
        let dominant = self
            .types
            .iter()
            .enumerate()
            .max_by_key(|(_, size)| *size)
            .expect("类型表不能为空")
            .0;
        Item {
            disk: self.disk,
            path: display(&self.path),
            bytes,
            files: self.files,
            directory: true,
            modified: self.modified,
            kind: if bytes == 0 {
                "无已计入大小"
            } else {
                KINDS[dominant]
            },
            advice: advice::folder(
                &self.path,
                &self.name,
                &self.markers,
                self.files,
                self.guarded || self.within_generated,
                self.incomplete,
                (bytes > 0 && u128::from(self.types[dominant]) * 10 >= u128::from(bytes) * 7)
                    .then_some(dominant),
            ),
        }
    }
}

#[derive(Default)]
struct Inventory {
    linked: HashSet<file_id::FileId>,
    extensions: HashMap<String, (u64, u64)>,
    totals: Totals,
    issues: Vec<String>,
    // 只保存根目录的直接子项；树图覆盖全部子目录，深层目录仍走有界排行榜。
    children: Vec<Item>,
    direct_file_bytes: u64,
    folders: Ranking,
    files: Ranking,
    reviews: Ranking,
    review_types: BTreeMap<&'static str, u64>,
}

impl Inventory {
    fn error(&mut self, path: &Path, err: io::Error) {
        self.totals.errors += 1;
        if self.issues.len() < 20 {
            self.issues.push(format!("{} — {err}", path.display()));
        }
    }

    fn file(
        &mut self,
        frame: &mut Frame,
        path: &Path,
        filename: std::ffi::OsString,
        stamp: Stamp,
        measured: io::Result<Measurement>,
    ) {
        let name = filename.to_string_lossy();
        let ext = Path::new(name.as_ref())
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let category = advice::kind(&ext);
        let bytes = stamp.file_len;
        let disk = match measured {
            Ok(m) => m.attribute(&mut self.linked),
            Err(error) => {
                if self.issues.len() < 20 {
                    self.issues
                        .push(format!("磁盘占用未计入：{} — {error}", path.display()));
                }
                Disk {
                    unknown: 1,
                    ..Disk::default()
                }
            }
        };
        frame.disk.add(disk);
        // 与主扫描共用一次元数据读取，零字节文件也计入扩展名数量。
        let advice = advice::file(&ext, category, frame.guarded, frame.generated);
        frame.markers.bytecode += u64::from(ext == "pyc");
        let stats = self.extensions.entry(ext).or_default();
        stats.0 += bytes;
        stats.1 += 1;
        let modified = stamp.modified();
        frame.markers.observe(&name.to_ascii_lowercase());
        frame.types[category] += bytes;
        frame.files += 1;
        frame.modified = frame.modified.max(modified);
        frame.members.push(Member {
            disk,
            review: advice.review,
            name: filename,
            bytes,
            stamp,
        });
        self.totals.files += 1;
        self.totals.bytes += bytes;
        if advice.review {
            *self.review_types.entry(advice.label).or_default() += 1;
        }
        let in_files = self.files.worth(bytes);
        let in_reviews = advice.review && self.reviews.worth(bytes);
        if in_files || in_reviews {
            let item = Item {
                disk,
                bytes,
                path: display(path),
                directory: false,
                files: 1,
                modified,
                kind: KINDS[category],
                advice,
            };
            if in_reviews {
                self.reviews.offer(item.clone());
            }
            if in_files {
                self.files.offer(item);
            }
        }
    }

    fn folder(&mut self, item: &Item, depth: usize) {
        if depth > 0 && item.advice.review {
            *self.review_types.entry(item.advice.label).or_default() += 1;
            self.reviews.offer(item.clone());
        }
        if depth == 1 {
            self.children.push(item.clone());
        }
        if depth > 0 {
            self.folders.offer(item.clone());
        }
    }
}

/// 扫描和按需取样共用目录边界，不跟随祖先中的重解析点。
pub fn checked_root(root: &Path) -> Result<(PathBuf, bool, bool), String> {
    if root
        .components()
        .any(|part| part == std::path::Component::ParentDir)
    {
        return Err("请使用不含上级跳转符的完整路径。".into());
    }
    if !root.is_absolute() {
        return Err("请输入完整的目录路径。".into());
    }
    let normalized = std::path::absolute(root).map_err(|err| err.to_string())?;
    let root = normalized.as_path();
    let mut guarded = false;
    let mut generated = false;
    // 直接选择深层子目录时，同样继承系统目录和依赖树的保护规则。
    for ancestor in root.ancestors() {
        let metadata =
            fs::symlink_metadata(ancestor).map_err(|e| format!("{} — {e}", ancestor.display()))?;
        if metadata.file_attributes() & REPARSE != 0 {
            return Err(format!(
                "路径经过重解析点，请选择实际目录：{}",
                ancestor.display()
            ));
        }
        if ancestor != root {
            if let Some(name) = ancestor.file_name() {
                let name = name.to_string_lossy().to_ascii_lowercase();
                guarded |= advice::protected(&name);
                generated |= advice::generated_name(&name);
            }
        }
    }
    Ok((normalized, guarded, generated))
}

/// 遇到权限不足时记录缺口；主动取消或根目录无法读取时不发布残缺报告。
pub fn run(
    root: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(&Totals, &Path) -> Result<(), String>,
) -> Result<Option<(Report, Catalog)>, String> {
    let started = Instant::now();
    let (normalized, guarded, generated) = checked_root(root)?;
    let root = normalized.as_path();
    let mut catalog = Catalog {
        root: normalized.clone(),
        ..Catalog::default()
    };
    let first = open_entry(root)
        .and_then(|f| {
            Frame::open(
                root.to_owned(),
                guarded,
                generated,
                Stamp::read(&f.metadata()?),
            )
        })
        .map_err(|e| format!("{} — {e}", root.display()))?;
    let mut stack = vec![first];
    let mut inventory = Inventory::default();
    let reader = Reader::new(root);
    let mut tick = Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        let depth = stack.len() - 1;
        let frame = stack.last_mut().expect("遍历栈应包含当前目录");
        if tick.elapsed() >= Duration::from_millis(250) {
            progress(&inventory.totals, &frame.path)?;
            tick = Instant::now();
        }
        let entry = match frame.entries.next() {
            Some(Ok(entry)) => entry,
            Some(Err(err)) => {
                inventory.error(&frame.path, err);
                frame.incomplete = true;
                continue;
            }
            None => {
                let mut done = stack.pop().expect("当前目录必须在栈顶");
                let info = done.item();
                inventory.folder(&info, depth);
                done.members.sort_unstable_by(|a, b| {
                    b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name))
                });
                catalog.branches.insert(
                    done.path.clone(),
                    Branch {
                        disk_order: Default::default(),
                        name_order: Default::default(),
                        info: info.clone(),
                        members: std::mem::take(&mut done.members),
                        complete: !done.incomplete,
                        guarded: done.guarded,
                        generated: done.generated,
                    },
                );
                if let Some(parent) = stack.last_mut() {
                    parent.members.push(Member {
                        review: info.advice.review,
                        disk: info.disk,
                        name: done.path.file_name().expect("子目录必须有名称").to_owned(),
                        bytes: info.bytes,
                        stamp: done.stamp,
                    });
                    parent.absorb(&done);
                    continue;
                }
                inventory.children.sort_unstable_by(|a, b| b.cmp(a));
                let mut extensions: Vec<_> = inventory
                    .extensions
                    .into_iter()
                    .map(|(name, (bytes, files))| Extension { name, bytes, files })
                    .collect();
                extensions.sort_unstable_by(|a, b| b.bytes.cmp(&a.bytes).then(a.name.cmp(&b.name)));
                return Ok(Some((
                    Report {
                        generation: 0,
                        root: display(root),
                        root_info: info,
                        elapsed_ms: started.elapsed().as_millis(),
                        totals: inventory.totals,
                        types: KINDS.into_iter().zip(done.types).collect(),
                        extensions,
                        files: inventory.files.finish(),
                        folders: inventory.folders.finish(),
                        children: inventory.children,
                        direct_file_bytes: inventory.direct_file_bytes,
                        reviews: inventory.reviews.finish(),
                        review_count: inventory.review_types.values().sum(),
                        review_types: inventory.review_types,
                        issues: inventory.issues,
                    },
                    catalog,
                )));
            }
        };
        let path = entry.path();
        // 同一句柄的基本信息既用于快照，也用于核对占用和硬链接，避免逐文件重复查询。
        match open_entry(&path).and_then(|handle| {
            let info = winapi_util::file::information(&handle);
            let stamp = match &info {
                Ok(info) => Stamp::from_info(info),
                // 部分文件系统只提供基础元数据，保留逻辑大小并单独报告未知占用。
                Err(_) => Stamp::read(&handle.metadata()?),
            };
            Ok((stamp, info, handle))
        }) {
            Ok((stamp, _, _)) if stamp.attrs & REPARSE != 0 => {
                inventory.totals.skipped += 1;
                frame.incomplete = true;
            }
            Ok((stamp, _, _handle)) if stamp.attrs & 0x10 != 0 => {
                match Frame::open(path, frame.guarded, frame.generated, stamp) {
                    Ok(child) => {
                        inventory.totals.folders += 1;
                        stack.push(child);
                    }
                    Err(err) => {
                        inventory.error(&entry.path(), err);
                        frame.incomplete = true;
                    }
                }
            }
            Ok((stamp, info, handle)) => {
                if depth == 0 {
                    inventory.direct_file_bytes += stamp.file_len;
                }
                let measured = info.and_then(|info| reader.measure(&path, &handle, &info));
                inventory.file(frame, &path, entry.file_name(), stamp, measured);
            }
            Err(err) => {
                inventory.error(&entry.path(), err);
                frame.incomplete = true;
            }
        }
    }
}
