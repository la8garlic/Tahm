//! 只比较选中文件与快照中的同尺寸文件，分块遇到首个不同字节即停止。
use crate::{
    catalog::{Catalog, Member, Stamp},
    report::{display, Item},
    scan,
};
use serde::Serialize;
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek},
    os::windows::fs::OpenOptionsExt,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Default, Serialize)]
pub struct Copies {
    checked: usize,
    matches: usize,
    skipped: usize,
    items: Vec<Item>,
    issues: Vec<String>,
    cancelled: bool,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    checked: usize,
    compared_bytes: u64,
}

fn open_unchanged(path: &Path, expected: &Member) -> Result<File, String> {
    scan::checked_root(path)?;
    // 仅共享读访问，让比对期间仍由其他程序写入的文件明确报告为跳过。
    let file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(path)
        .map_err(|e| e.to_string())?;
    verify(&file, expected)?;
    Ok(file)
}

fn verify(file: &File, expected: &Member) -> Result<(), String> {
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || Stamp::read(&meta) != expected.stamp {
        return Err("文件在扫描后发生变化。".into());
    }
    Ok(())
}

pub fn find(
    catalog: &Catalog,
    path: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(&Progress) -> Result<(), String>,
) -> Result<Copies, String> {
    let original = catalog.member(path)?;
    if original.directory() || original.bytes == 0 {
        return Err("请选择一个非空文件。".into());
    }
    let mut source = open_unchanged(path, original)?;
    let mut output = Copies::default();
    let mut activity = Progress {
        checked: 0,
        compared_bytes: 0,
    };
    let mut last_update = Instant::now();
    let (mut a, mut b) = (vec![0; 128 * 1024], vec![0; 128 * 1024]);
    'folders: for (folder, branch) in &catalog.branches {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        // 目录成员已按大小降序排列，可以直接跳过两个尺寸区间。
        let first = branch.members.partition_point(|m| m.bytes > original.bytes);
        for entry in branch.members[first..]
            .iter()
            .take_while(|m| m.bytes == original.bytes)
        {
            if cancel.load(Ordering::Relaxed) {
                break 'folders;
            }
            if entry.directory() {
                continue;
            }
            let other = folder.join(&entry.name);
            if other == path {
                continue;
            }
            enum Failure {
                Candidate(String),
                Comparison(String),
            }
            let result = (|| -> Result<bool, Failure> {
                let mut file = open_unchanged(&other, entry).map_err(Failure::Candidate)?;
                source
                    .rewind()
                    .map_err(|e| Failure::Comparison(e.to_string()))?;
                let mut remaining = original.bytes;
                while remaining > 0 {
                    if cancel.load(Ordering::Relaxed) {
                        return Ok(false);
                    }
                    let len = remaining.min(a.len() as u64) as usize;
                    source
                        .read_exact(&mut a[..len])
                        .map_err(|e| Failure::Comparison(e.to_string()))?;
                    file.read_exact(&mut b[..len])
                        .map_err(|e| Failure::Candidate(e.to_string()))?;
                    activity.compared_bytes += len as u64;
                    if last_update.elapsed() >= Duration::from_millis(250) {
                        progress(&activity).map_err(Failure::Comparison)?;
                        last_update = Instant::now();
                    }
                    if a[..len] != b[..len] {
                        return Ok(false);
                    }
                    remaining -= len as u64;
                }
                verify(&file, entry).map_err(Failure::Candidate)?;
                Ok(true)
            })();
            if cancel.load(Ordering::Relaxed) {
                break 'folders;
            }
            match result {
                Ok(equal) => {
                    output.checked += 1;
                    if equal {
                        output.matches += 1;
                        if output.items.len() < 100 {
                            output.items.push(catalog.item(folder, entry, branch));
                        }
                    }
                }
                Err(Failure::Comparison(error)) => return Err(error),
                Err(Failure::Candidate(error)) => {
                    output.skipped += 1;
                    if output.issues.len() < 5 {
                        output.issues.push(format!("{} — {error}", display(&other)));
                    }
                }
            }
            activity.checked = output.checked + output.skipped;
        }
    }
    verify(&source, original)?;
    output.items.sort_unstable_by(|a, b| a.path.cmp(&b.path));
    output.cancelled = cancel.load(Ordering::Relaxed);
    Ok(output)
}
