//! 只用文件系统证据解释用途，删除条件始终由使用者核实。

use std::{os::windows::fs::MetadataExt, path::Path};

use serde::Serialize;

pub const KINDS: [&str; 8] = [
    "文档",
    "图片",
    "影音",
    "归档",
    "程序与依赖",
    "代码",
    "磁盘与数据",
    "其他",
];

pub fn kind(ext: &str) -> usize {
    match ext {
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "csv"
        | "epub" => 0,
        "jpg" | "jpeg" | "png" | "heic" | "webp" | "gif" | "svg" | "psd" | "raw" | "tif"
        | "bmp" => 1,
        "mp4" | "mkv" | "mov" | "avi" | "wmv" | "webm" | "wav" | "flac" | "mp3" | "m4a" => 2,
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "bak" => 3,
        "exe" | "dll" | "msi" | "sys" | "lib" | "rlib" | "obj" | "pdb" | "so" | "jar" | "pyc" => 4,
        "rs" | "py" | "js" | "ts" | "tsx" | "jsx" | "cpp" | "c" | "h" | "cs" | "java" | "html"
        | "css" | "go" => 5,
        "iso" | "vhd" | "vhdx" | "vmdk" | "db" | "sqlite" | "sqlite3" | "parquet"
        | "safetensors" | "gguf" | "onnx" => 6,
        _ => 7,
    }
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Advice {
    pub label: &'static str,
    pub reason: &'static str,
    pub review: Option<ReviewLevel>,
}

#[derive(Clone, Copy, Serialize, serde::Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum ReviewLevel {
    Rebuild,
    Manual,
}

impl Advice {
    fn keep(label: &'static str, reason: &'static str) -> Self {
        Self {
            label,
            reason,
            review: None,
        }
    }

    fn review(level: ReviewLevel, label: &'static str, reason: &'static str) -> Self {
        Self {
            label,
            reason,
            review: Some(level),
        }
    }
}

pub fn protected(name: &str) -> bool {
    matches!(
        name,
        "windows"
            | "program files"
            | "program files (x86)"
            | "programdata"
            | "appdata"
            | "system volume information"
            | "$recycle.bin"
            | ".git"
            | ".svn"
    )
}

fn managed() -> Advice {
    Advice::keep(
        "建议保留",
        "位于系统、应用或版本控制管理的位置。请通过对应程序管理此处的数据。",
    )
}

pub fn file(ext: &str, category: usize, guarded: bool, generated: bool) -> Advice {
    if guarded {
        return managed();
    }
    if generated {
        return Advice::keep(
            "随目录管理",
            "位于依赖或生成目录内，单独移除文件可能破坏工具运行。",
        );
    }
    match ext {
        "safetensors" | "gguf" | "onnx" => Advice::keep(
            "模型文件",
            "可能是模型权重或推理模型，请核对使用它的工作流，以及能否重新取得同一版本。",
        ),
        "msi" | "msix" => Advice::review(
            ReviewLevel::Manual,
            "安装包",
            "扩展名表明这是安装包。确认软件已安装、无需离线修复且可重新取得后，可考虑移除。",
        ),
        "iso" => Advice::review(
            ReviewLevel::Manual,
            "光盘镜像",
            "可能用于安装或归档。先确认未挂载、无需离线使用，并且有其他来源。",
        ),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" => Advice::review(
            ReviewLevel::Manual,
            "归档待核对",
            "后缀表明这是归档包。扫描未比对归档内容；仅在确认另有完整副本且无需原包时考虑移除，唯一备份请保留。",
        ),
        "crdownload" | "part" => Advice::review(
            ReviewLevel::Manual,
            "疑似下载分片",
            "该后缀常用于未完成的下载。先在下载工具内核对任务状态，仅清理已放弃的任务。",
        ),
        "vhd" | "vhdx" | "vmdk" => Advice::keep(
            "虚拟磁盘",
            "可能包含完整的虚拟机、WSL 环境或用户数据，应从所属工具中管理。",
        ),
        "db" | "sqlite" | "sqlite3" | "bak" => Advice::keep(
            "数据或备份",
            "可能保存应用记录或唯一备份，请先确认所属应用及恢复方式。",
        ),
        _ if category <= 2 || category == 5 => Advice::keep(
            "建议保留",
            "可能是个人作品、资料或源码。请打开所在目录核对用途与备份。",
        ),
        _ => Advice::keep(
            "用途待确认",
            "仅凭名称和大小无法确定用途。请先核对所属目录和使用它的程序。",
        ),
    }
}

pub fn generated_name(name: &str) -> bool {
    matches!(name, "node_modules" | "target" | "__pycache__")
}

#[derive(Default)]
pub struct Markers {
    manifest: bool,
    cargo: bool,
    python: bool,
    rust_output: bool,
    pub bytecode: u64,
    pub missing_source: bool,
    pub subdirectories: bool,
}

// 证据文件必须实际位于该路径；链接、无法读取的条目都不能佐证可重建性。
fn regular(path: &Path) -> bool {
    path.symlink_metadata()
        .is_ok_and(|m| m.is_file() && m.file_attributes() & 0x400 == 0)
}

/// PEP 3147/488：module.tag[.opt-N].pyc 对应上一级的 module.py。
pub fn bytecode_has_source(cache: &Path, filename: &str) -> bool {
    let Some((stem, _extension)) = filename.rsplit_once('.') else {
        return false;
    };
    let Some((prefix, suffix)) = stem.rsplit_once('.') else {
        return false;
    };
    let (module, tag) = if suffix.starts_with("opt-") {
        let Some(parts) = prefix.rsplit_once('.') else {
            return false;
        };
        parts
    } else {
        (prefix, suffix)
    };
    !module.is_empty()
        && (tag.starts_with("cpython-") || tag.starts_with("pypy"))
        && cache
            .parent()
            .is_some_and(|p| regular(&p.join(format!("{module}.py"))))
}

impl Markers {
    pub fn observe(&mut self, name: &str) {
        match name {
            "package.json" => self.manifest = true,
            "cargo.toml" => self.cargo = true,
            "pyproject.toml" | "requirements.txt" => self.python = true,
            ".rustc_info.json" => self.rust_output = true,
            _ => {}
        }
    }
}

pub fn folder(
    path: &Path,
    name: &str,
    markers: &Markers,
    count: u64,
    guarded: bool,
    incomplete: bool,
    majority: Option<usize>,
) -> Advice {
    if guarded {
        return managed();
    }
    if incomplete {
        return Advice::keep(
            "范围不完整",
            "此目录包含跳过或无法读取的项目，当前大小为已统计部分，请先检查原目录。",
        );
    }
    if markers.cargo || markers.manifest || markers.python {
        return Advice::keep(
            "开发项目",
            "目录中有项目清单，通常包含源码和配置。请保留项目本身，单独复核生成目录。",
        );
    }
    if let Some(parent) = path.parent() {
        match name {
            "node_modules" if count > 0 && regular(&parent.join("package.json")) => {
                let locked = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]
                    .iter().any(|file| regular(&parent.join(file)));
                return if locked {
                    Advice::review(ReviewLevel::Rebuild, "项目依赖", "同级有 package.json 和依赖锁文件。确认依赖源仍可用、手工修改已保存，再按锁定版本重装。")
                } else {
                    Advice::review(ReviewLevel::Manual, "项目依赖", "同级有 package.json，但未在此处找到依赖锁文件。请核对工作区的锁文件、依赖来源和手工修改。")
                };
            }
            "target" if markers.rust_output && regular(&parent.join("Cargo.toml")) => return Advice::review(ReviewLevel::Rebuild, "Rust 构建产物", "发现 Cargo 清单和编译器标记。确认无需保留打包结果后，可在所属项目运行 cargo clean。"),
            "__pycache__" if count > 0 && count == markers.bytecode && !markers.subdirectories => {
                return if markers.missing_source {
                    Advice::review(ReviewLevel::Manual, "Python 字节码", "仅发现 .pyc 文件，但至少一项未找到对应的本地源码。可能是仅有的可运行副本，请先保留。")
                } else {
                    Advice::review(ReviewLevel::Rebuild, "Python 字节码", "目录内仅有 .pyc 文件，上一级能找到每一项对应的 .py 源码。关闭使用它的程序后，下次导入时可重建。")
                };
            }
            _ => {}
        }
    }
    match majority {
        Some(0) => Advice::keep(
            "文档资料",
            "文档占此目录至少七成大小，可能包含工作资料或个人记录。先核对原稿和备份。",
        ),
        Some(1) => Advice::keep(
            "图片资料",
            "图片占此目录至少七成大小，可能是相册或设计素材。先核对原图和备份。",
        ),
        Some(2) => Advice::keep(
            "影音资料",
            "音视频占此目录至少七成大小，可能是录制素材或媒体收藏。先核对来源和备份。",
        ),
        Some(3) => Advice::keep(
            "归档集合",
            "归档和备份文件占此目录至少七成大小。核对归档内的内容与可恢复副本，再逐项决定。",
        ),
        Some(5) => Advice::keep(
            "源代码",
            "源码占此目录至少七成大小，可能包含手工修改。请先核对版本记录和备份。",
        ),
        Some(6) => Advice::keep(
            "磁盘与数据",
            "磁盘映像、数据库或模型文件等数据占此目录至少七成大小。请核对使用它们的程序和恢复方式。",
        ),
        _ => Advice::keep(
            "核对内容",
            "目录用途需要结合主要文件类型、最近修改时间和所在路径判断。",
        ),
    }
}
