//! 扫描快照按目录保存短名称。浏览和筛选使用内存索引，完整路径只在显示时生成。

use crate::{
    advice,
    allocation::Disk,
    report::{display, Item, Ranking},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::{OsStr, OsString},
    fs::{File, Metadata, OpenOptions},
    io,
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::OnceLock,
};

/// 只读属性并打开重解析点本身。硬链接的目录项可能过期，扫描与复核均以句柄为准。
pub fn open_entry(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .access_mode(0x80)
        .share_mode(3)
        .custom_flags(0x0020_0000 | 0x0200_0000)
        .open(path)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub file_len: u64,
    created: u64,
    written: u64,
    pub attrs: u32,
}

impl Stamp {
    pub fn verify(self, current: Self, path: &Path) -> Result<(), String> {
        let change = if self.file_len != current.file_len {
            format!("大小从 {} 变为 {} 字节", self.file_len, current.file_len)
        } else if self.created != current.created {
            "创建时间已改变".into()
        } else if self.written != current.written {
            "最后写入时间已改变".into()
        } else if self.attrs != current.attrs {
            format!("文件属性从 {:#x} 变为 {:#x}", self.attrs, current.attrs)
        } else {
            return Ok(());
        };
        Err(format!("{}：{change}。请重新扫描并复核。", path.display()))
    }
    pub fn from_info(info: &winapi_util::file::Information) -> Self {
        let attrs = info.file_attributes() as u32;
        Self {
            file_len: if attrs & 0x10 == 0 {
                info.file_size()
            } else {
                0
            },
            attrs,
            created: info.creation_time().unwrap_or(0),
            written: info.last_write_time().unwrap_or(0),
        }
    }
    pub fn read(m: &Metadata) -> Self {
        Self {
            // Windows 枚举目录与按路径查询时可能返回不同的目录索引长度；
            // 只有普通文件的长度能作为内容变化的依据，子目录内容在回收前逐项核对。
            file_len: if m.is_file() { m.len() } else { 0 },
            created: m.creation_time(),
            written: m.last_write_time(),
            attrs: m.file_attributes(),
        }
    }
    pub fn modified(self) -> Option<u64> {
        // FILETIME 从 1601 年起，以 100 纳秒为单位。
        (self.written / 10_000_000).checked_sub(11_644_473_600)
    }
}

pub struct Member {
    pub disk: Disk,
    pub name: OsString,
    pub stamp: Stamp,
    pub bytes: u64,
    pub review: Option<advice::ReviewLevel>,
}
impl Member {
    fn named(&self, query: &str) -> bool {
        query.is_empty() || self.name.to_string_lossy().to_lowercase().contains(query)
    }
    fn matches_file(&self, query: &str, extension: Option<&str>) -> bool {
        !self.directory()
            && self.named(query)
            && extension.is_none_or(|wanted| {
                Path::new(&self.name)
                    .extension()
                    .and_then(OsStr::to_str)
                    .unwrap_or("")
                    .eq_ignore_ascii_case(wanted)
            })
    }
    pub fn directory(&self) -> bool {
        self.stamp.attrs & 0x10 != 0
    }
}

pub struct Branch {
    pub disk_order: OnceLock<Vec<usize>>,
    pub name_order: OnceLock<Vec<usize>>,
    pub info: Item,
    pub members: Vec<Member>,
    pub complete: bool,
    pub guarded: bool,
    pub generated: bool,
}

#[derive(Default)]
pub struct Catalog {
    pub branches: HashMap<PathBuf, Branch>,
    pub root: PathBuf,
}

#[derive(Serialize)]
pub struct Page {
    pub dirs: Vec<Item>,
    pub offset: usize,
    pub folder: Item,
    pub rows: Vec<Item>,
    pub matches: usize,
}

#[derive(Serialize)]
pub struct MapPage {
    pub previews: HashMap<String, Vec<Item>>,
    pub map_offset: usize,
    pub folder: Item,
    pub tiles: Vec<Item>,
    pub rest_bytes: u64,
    pub rest_count: usize,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Metric {
    Logical,
    Allocated,
}

impl Metric {
    fn weight(self, member: &Member) -> u64 {
        match self {
            Self::Logical => member.bytes,
            Self::Allocated => member.disk.charged,
        }
    }
}

#[derive(serde::Deserialize)]
pub struct Viewport {
    offset: usize,
    focus: Option<String>,
    metric: Metric,
}

impl Branch {
    /// 逻辑大小顺序沿用扫描索引；只有打开磁盘占用视图的目录才建立第二份排序。
    fn allocation_order(&self) -> &[usize] {
        self.disk_order.get_or_init(|| {
            let mut indices: Vec<_> = (0..self.members.len()).collect();
            indices.sort_unstable_by_key(|&i| (std::cmp::Reverse(self.members[i].disk.charged), i));
            indices
        })
    }
    fn ordered(&self, metric: Metric) -> impl Iterator<Item = &Member> + Clone {
        let order = match metric {
            Metric::Logical => None,
            Metric::Allocated => Some(self.allocation_order()),
        };
        (0..self.members.len()).map(move |i| &self.members[order.map_or(i, |indices| indices[i])])
    }
}

#[derive(serde::Deserialize)]
pub struct FileCursor {
    bytes: u64,
    path: String,
}

#[derive(serde::Deserialize)]
pub struct ReviewFilter {
    level: advice::ReviewLevel,
    query: String,
    category: Option<String>,
    // 前端把当前语言中匹配搜索词的分类还原为规则标识。
    labels: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SelectionOrder {
    Reviews {
        filter: ReviewFilter,
    },
    Directory {
        path: PathBuf,
        query: String,
        metric: Metric,
    },
    Files {
        query: String,
        extension: Option<String>,
        minimum: u64,
    },
}

impl Catalog {
    fn matching_reviews<'a>(&'a self, filter: &'a ReviewFilter) -> impl Iterator<Item = Item> + 'a {
        let query = filter.query.to_lowercase();
        self.branches
            .iter()
            .flat_map(move |(dir, branch)| {
                branch
                    .members
                    .iter()
                    .filter(|m| m.review == Some(filter.level))
                    .map(move |m| self.item(dir, m, branch))
            })
            .filter(move |item| {
                filter
                    .category
                    .as_deref()
                    .is_none_or(|label| label == item.advice.label)
                    && (query.is_empty()
                        || filter.labels.iter().any(|label| label == item.advice.label)
                        || item.path.to_lowercase().contains(&query))
            })
    }

    pub fn find_reviews(
        &self,
        filter: &ReviewFilter,
        after: Option<&FileCursor>,
    ) -> (usize, Vec<Item>) {
        let mut matches = 0;
        let mut largest = Ranking::default();
        for item in self.matching_reviews(filter) {
            matches += 1;
            if after.is_none_or(|cursor| (item.bytes, &item.path) < (cursor.bytes, &cursor.path)) {
                largest.offer(item);
            }
        }
        (matches, largest.finish())
    }
    /// 按大小和完整路径降序续页，相同大小的文件也有确定位置，每页只保留一百项。
    pub fn find_files(
        &self,
        query: &str,
        extension: Option<&str>,
        minimum: u64,
        after: Option<&FileCursor>,
    ) -> (usize, Vec<Item>) {
        let query = query.to_lowercase();
        let mut matches = 0;
        let mut largest = Ranking::default();
        for (path, branch) in &self.branches {
            for member in branch.members.iter().take_while(|m| m.bytes >= minimum) {
                if !member.matches_file(&query, extension) {
                    continue;
                }
                matches += 1;
                if largest.worth(member.bytes)
                    && after.is_none_or(|cursor| member.bytes <= cursor.bytes)
                {
                    let item = self.item(path, member, branch);
                    if after
                        .is_none_or(|cursor| item.bytes < cursor.bytes || item.path < cursor.path)
                    {
                        largest.offer(item);
                    }
                }
            }
        }
        (matches, largest.finish())
    }

    /// 跨页 Shift 选取沿用显示时的筛选和排序，只把两个端点之间的条目送往前端。
    pub fn selection_range(
        &self,
        order: SelectionOrder,
        start: &Path,
        end: &Path,
    ) -> Result<Vec<Item>, String> {
        let mut rows = Vec::new();
        match order {
            SelectionOrder::Reviews { filter } => {
                let a = (self.member(start)?.bytes, display(start));
                let b = (self.member(end)?.bytes, display(end));
                let (low, high) = if a <= b { (a, b) } else { (b, a) };
                rows.extend(self.matching_reviews(&filter).filter(|item| {
                    (item.bytes, &item.path) >= (low.0, &low.1)
                        && (item.bytes, &item.path) <= (high.0, &high.1)
                }));
                rows.sort_unstable_by(|a, b| b.cmp(a));
                Ok(rows)
            }
            SelectionOrder::Directory {
                path,
                query,
                metric,
            } => {
                if start.parent() != Some(path.as_path()) || end.parent() != Some(path.as_path()) {
                    return Err("范围端点不在当前目录。".into());
                }
                let branch = self.branch(&path)?;
                let query = query.to_lowercase();
                let mut inside = false;
                for m in branch.ordered(metric).filter(|m| m.named(&query)) {
                    let boundary = Some(m.name.as_os_str()) == start.file_name()
                        || Some(m.name.as_os_str()) == end.file_name();
                    if inside || boundary {
                        rows.push(self.item(&path, m, branch));
                    }
                    if boundary {
                        if inside || start == end {
                            return Ok(rows);
                        }
                        inside = true;
                    }
                }
                Err("范围端点不在当前筛选结果中。".into())
            }
            SelectionOrder::Files {
                query,
                extension,
                minimum,
            } => {
                let a = (self.member(start)?.bytes, display(start));
                let b = (self.member(end)?.bytes, display(end));
                let (low, high) = if a <= b { (a, b) } else { (b, a) };
                let query = query.to_lowercase();
                for (dir, branch) in &self.branches {
                    let first = branch.members.partition_point(|m| m.bytes > high.0);
                    for m in branch.members[first..]
                        .iter()
                        .take_while(|m| m.bytes >= minimum.max(low.0))
                    {
                        if !m.matches_file(&query, extension.as_deref()) {
                            continue;
                        }
                        let item = self.item(dir, m, branch);
                        if (m.bytes != low.0 || item.path >= low.1)
                            && (m.bytes != high.0 || item.path <= high.1)
                        {
                            rows.push(item);
                        }
                    }
                }
                rows.sort_unstable_by(|a, b| b.cmp(a));
                Ok(rows)
            }
        }
    }

    /// 从全部目录中先筛选再取最大项，避免遗漏排行榜之外的旧资料。
    pub fn old_folders(&self, before: u64, minimum: u64, query: &str) -> (usize, Vec<Item>) {
        let query = query.to_lowercase();
        let mut matches = 0;
        let mut largest = Ranking::default();
        for (path, branch) in &self.branches {
            let item = &branch.info;
            if path == &self.root
                || !branch.complete
                || item.bytes < minimum
                || !item.modified.is_some_and(|t| t < before)
            {
                continue;
            }
            if !query.is_empty() && !item.path.to_lowercase().contains(&query) {
                continue;
            }
            matches += 1;
            if largest.worth(item.bytes) {
                largest.offer(item.clone());
            }
        }
        (matches, largest.finish())
    }

    pub fn branch(&self, path: &Path) -> Result<&Branch, String> {
        self.branches
            .get(path)
            .ok_or_else(|| "目录不在当前扫描快照中。".into())
    }

    pub fn member(&self, path: &Path) -> Result<&Member, String> {
        let parent = path.parent().ok_or("磁盘根不能加入清理清单。")?;
        let name = path.file_name().ok_or("请选择一个目录项。")?;
        let branch = self.branch(parent)?;
        // 大目录的批量复核按名称反复查快照，按需建立索引以避免平方级遍历。
        let member = if branch.members.len() <= 100 {
            branch.members.iter().find(|m| m.name == name)
        } else {
            let indices = branch.name_order.get_or_init(|| {
                let mut indices: Vec<_> = (0..branch.members.len()).collect();
                indices
                    .sort_unstable_by(|&a, &b| branch.members[a].name.cmp(&branch.members[b].name));
                indices
            });
            indices
                .binary_search_by(|&i| branch.members[i].name.as_os_str().cmp(name))
                .ok()
                .map(|i| &branch.members[indices[i]])
        };
        member.ok_or_else(|| "项目不在当前扫描快照中，请刷新。".into())
    }

    pub(crate) fn item(&self, path: &Path, row: &Member, branch: &Branch) -> Item {
        let full = path.join(&row.name);
        if row.directory() {
            return self.branches[&full].info.clone();
        }
        let ext = full
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let category = advice::kind(&ext);
        Item {
            path: display(&full),
            bytes: row.bytes,
            disk: row.disk,
            files: 1,
            modified: row.stamp.modified(),
            directory: false,
            kind: advice::KINDS[category],
            advice: advice::file(&ext, category, branch.guarded, branch.generated),
        }
    }

    pub fn page(&self, path: &Path, query: &str, viewport: Viewport) -> Result<Page, String> {
        let Viewport {
            offset,
            focus,
            metric,
        } = viewport;
        let branch = self.branch(path)?;
        let ordered = branch.ordered(metric);
        let query = query.to_lowercase();
        // 行号按筛选后的顺序计算，面积块序号则始终按整层目录计算。
        let offset = focus
            .as_deref()
            .and_then(|name| {
                ordered
                    .clone()
                    .filter(|m| m.named(&query))
                    .position(|m| m.name == OsStr::new(name))
            })
            .map_or(offset, |i| i / 100 * 100);
        // 普通翻页只构造可见的 100 项，名称筛选才检查整层。
        let (rows, matches) = if query.is_empty() {
            (
                ordered
                    .clone()
                    .skip(offset)
                    .take(100)
                    .map(|entry| self.item(path, entry, branch))
                    .collect(),
                branch.members.len(),
            )
        } else {
            let mut count = 0;
            let mut rows = Vec::new();
            for entry in ordered.clone().filter(|m| m.named(&query)) {
                if count >= offset && rows.len() < 100 {
                    rows.push(self.item(path, entry, branch));
                }
                count += 1;
            }
            (rows, count)
        };
        Ok(Page {
            dirs: ordered
                .filter(|m| m.directory())
                .take(60)
                .map(|m| self.item(path, m, branch))
                .collect(),
            offset,
            folder: branch.info.clone(),
            rows,
            matches,
        })
    }

    pub fn map_page(&self, path: &Path, viewport: Viewport) -> Result<MapPage, String> {
        let Viewport {
            offset,
            focus,
            metric,
        } = viewport;
        let branch = self.branch(path)?;
        let ordered = branch.ordered(metric);
        let map_offset = focus
            .as_deref()
            .and_then(|name| {
                ordered
                    .clone()
                    .take_while(|m| metric.weight(m) > 0)
                    .position(|m| m.name == OsStr::new(name))
            })
            .map_or(offset, |i| i / 48 * 48)
            .min(branch.members.len());
        let visible: Vec<_> = ordered
            .clone()
            .skip(map_offset)
            .take(48)
            .take_while(|m| metric.weight(m) > 0)
            .map(|m| self.item(path, m, branch))
            .collect();
        let end = map_offset + visible.len();
        let total = match metric {
            Metric::Logical => branch.info.bytes,
            Metric::Allocated => branch.info.disk.charged,
        };
        let rest_bytes = total
            - ordered
                .clone()
                .take(end)
                .map(|m| metric.weight(m))
                .sum::<u64>();
        let positive = match metric {
            Metric::Logical => branch.members.partition_point(|m| m.bytes > 0),
            Metric::Allocated => branch
                .allocation_order()
                .partition_point(|&i| branch.members[i].disk.charged > 0),
        };
        let mut previews = HashMap::new();
        for child in ordered
            .clone()
            .skip(map_offset)
            .take(visible.len())
            .filter(|m| m.directory())
            .take(12)
        {
            let path = path.join(&child.name);
            let dir = &self.branches[&path];
            let items = dir
                .ordered(metric)
                .take(12)
                .take_while(|m| metric.weight(m) > 0)
                .map(|m| self.item(&path, m, dir))
                .collect();
            previews.insert(display(&path), items);
        }
        Ok(MapPage {
            previews,
            map_offset,
            folder: branch.info.clone(),
            tiles: visible,
            rest_bytes,
            rest_count: positive.saturating_sub(end),
        })
    }
}
