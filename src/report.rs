//! 深层排行榜只保留前 100 项，根目录的直属目录完整保留以绘制面积图。

use std::{cmp::Reverse, collections::BinaryHeap, path::Path};

use serde::Serialize;

use crate::advice::Advice;

pub const LIMIT: usize = 100;

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct Item {
    pub bytes: u64,
    pub path: String,
    pub directory: bool,
    pub files: u64,
    pub modified: Option<u64>,
    pub kind: &'static str,
    pub advice: Advice,
    pub disk: crate::allocation::Disk,
}

#[derive(Default)]
pub struct Ranking(BinaryHeap<Reverse<Item>>);

impl Ranking {
    pub fn worth(&self, bytes: u64) -> bool {
        self.0.len() < LIMIT || self.0.peek().is_some_and(|entry| bytes >= entry.0.bytes)
    }

    pub fn offer(&mut self, item: Item) {
        if self.0.len() < LIMIT {
            self.0.push(Reverse(item));
        } else if let Some(mut smallest) = self.0.peek_mut() {
            if item > smallest.0 {
                *smallest = Reverse(item);
            }
        }
    }

    pub fn finish(self) -> Vec<Item> {
        self.0
            .into_sorted_vec()
            .into_iter()
            .map(|entry| entry.0)
            .collect()
    }
}

#[derive(Default, Serialize)]
pub struct Totals {
    pub bytes: u64,
    pub files: u64,
    pub folders: u64,
    pub skipped: u64,
    pub errors: u64,
}

#[derive(Serialize)]
pub struct Extension {
    pub name: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Serialize)]
pub struct Report {
    pub generation: u64,
    pub root: String,
    pub root_info: Item,
    pub elapsed_ms: u128,
    pub totals: Totals,
    pub types: Vec<(&'static str, u64)>,
    pub extensions: Vec<Extension>,
    pub children: Vec<Item>,
    pub direct_file_bytes: u64,
    pub folders: Vec<Item>,
    pub files: Vec<Item>,
    pub reviews: Vec<Item>,
    pub review_count: u64,
    pub review_types: std::collections::BTreeMap<&'static str, u64>,
    pub issues: Vec<String>,
}

pub fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
