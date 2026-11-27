/** 仅在本机保存最近八个扫描位置的汇总，文件名和清理清单不写入历史。 */
export type Snapshot = {
  root: string;
  time: number;
  bytes: number;
  files: number;
  folders: number;
  errors: number;
  skipped: number;
  types: [string, number][];
};
// 与桌面应用标识一起保持稳定，让更名前的扫描记录在升级后继续可用。
const key = "aclean.scan-history.v1";
export function readHistory(): Snapshot[] {
  const saved = localStorage.getItem(key);
  if (saved === null) return [];
  const data: unknown = JSON.parse(saved);
  if (
    !Array.isArray(data) ||
    !data.every(
      (s) =>
        s &&
        typeof s.root === "string" &&
        ["time", "bytes", "files", "folders", "errors", "skipped"].every((field) =>
          Number.isFinite(s[field]),
        ) &&
        Array.isArray(s.types) &&
        s.types.every(
          (entry: unknown) =>
            Array.isArray(entry) && typeof entry[0] === "string" && Number.isFinite(entry[1]),
        ),
    )
  )
    throw Error("扫描历史格式无效。");
  return data.slice(0, 8);
}
export function record(report: ScanReport, history: Snapshot[]) {
  const snapshot: Snapshot = {
    root: report.root,
    time: Date.now(),
    ...report.totals,
    types: report.types,
  };
  const next = [snapshot, ...history.filter((s) => s.root !== report.root)].slice(0, 8);
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
export function clearHistory() {
  localStorage.removeItem(key);
}
