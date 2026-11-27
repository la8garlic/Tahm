import { useMemo, useRef, useState } from "react";
import * as ipc from "./ipc.js";
import { useData } from "./shared";

export const contains = (parent: string, child: string) =>
  child === parent || child.startsWith(parent.endsWith("\\") ? parent : parent + "\\");
export function covering(paths: ReadonlySet<string>, path: string, includeSelf = true) {
  if (includeSelf && paths.has(path)) return path;
  for (let at = path.lastIndexOf("\\"); at > 0; at = path.lastIndexOf("\\", at - 1)) {
    const parent = path.slice(0, at);
    if (paths.has(parent)) return parent;
    if (parent.endsWith(":") && paths.has(parent + "\\")) return parent + "\\";
  }
  return null;
}
/** 清单和估算都使用同一组顶层路径；保留原始点选记录，取消父目录后能恢复子项。 */
export function rootsOf(items: ScanItem[]) {
  const unique = new Map(items.map((i) => [i.path, i]));
  const paths = new Set(unique.keys());
  return [...unique.values()].filter((i) => !covering(paths, i.path, false));
}
export function useEstimate(
  generation: number | null,
  paths: string[],
  revision: number,
  run: (op: () => Promise<unknown>) => void,
  delay = 0,
) {
  return useData(
    JSON.stringify([generation, paths, revision]),
    async (signal) => {
      if (generation === null || !paths.length) return null;
      const ticket = crypto.randomUUID();
      const cancel = () => run(() => ipc.cancelEstimate(ticket));
      signal.addEventListener("abort", cancel);
      try {
        return await ipc.estimateReclaim(generation, paths, ticket);
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    },
    delay,
  );
}
export type Surface = { key: string; rows: ScanItem[]; order?: SelectionOrder };
export type Gesture = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; detail?: number };
type Entry = { item: ScanItem; scope: string };
type Entries = Map<string, Entry>;

export function useSelection(generation: number, run: (op: () => Promise<unknown>) => void) {
  const [entries, setEntries] = useState<Entries>(new Map());
  const current = useRef(entries),
    sequence = useRef(0);
  const anchor = useRef<{ scope: string; path: string } | null>(null);
  const beforeOpen = useRef<{ path: string; entries: Entries; anchor: typeof anchor.current } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  function save(next: Entries) {
    current.current = next;
    setEntries(next);
  }
  function interrupt() {
    sequence.current++;
    setLoading(false);
  }
  function pick(item: ScanItem, surface: Surface, event: Gesture, toggle = false) {
    const { ctrlKey, metaKey, shiftKey } = event,
      add = ctrlKey || metaKey || toggle;
    if (event.detail === 2 && item.directory && !shiftKey && !add) return;
    interrupt();
    const old = current.current,
      ref = anchor.current,
      ticket = sequence.current;
    beforeOpen.current =
      event.detail === 1 && !add && !shiftKey ? { path: item.path, entries: old, anchor: ref } : null;
    function apply(items: ScanItem[]) {
      if (ticket !== sequence.current) return;
      const next = new Map(old);
      // 普通点击或 Shift 替换当前列表的选择，其他目录或筛选结果中的选择继续保留。
      if (!add) for (const [path, entry] of next) if (entry.scope === surface.key) next.delete(path);
      for (const i of items) next.set(i.path, { item: i, scope: surface.key });
      save(next);
    }
    if (shiftKey && ref?.scope === surface.key) {
      const start = surface.rows.findIndex((i) => i.path === ref.path),
        end = surface.rows.findIndex((i) => i.path === item.path);
      if (start >= 0 && end >= 0) {
        apply(surface.rows.slice(Math.min(start, end), Math.max(start, end) + 1));
        return;
      }
      if (surface.order) {
        const order = surface.order;
        setLoading(true);
        run(async () => {
          try {
            apply(await ipc.selectionRange(generation, order, ref.path, item.path));
          } finally {
            if (ticket === sequence.current) setLoading(false);
          }
        });
        return;
      }
    }
    anchor.current = { scope: surface.key, path: item.path };
    if (add && !shiftKey && old.has(item.path)) {
      const next = new Map(old);
      next.delete(item.path);
      save(next);
    } else apply([item]);
  }
  function page(surface: Surface, remove: boolean) {
    interrupt();
    beforeOpen.current = null;
    anchor.current = null;
    const next = new Map(current.current);
    for (const item of surface.rows) {
      if (remove) next.delete(item.path);
      else next.set(item.path, { item, scope: surface.key });
    }
    save(next);
  }
  function remove(path: string) {
    interrupt();
    beforeOpen.current = null;
    if (anchor.current?.path === path) anchor.current = null;
    const next = new Map(current.current);
    next.delete(path);
    save(next);
  }
  function clear() {
    interrupt();
    anchor.current = null;
    beforeOpen.current = null;
    save(new Map());
  }
  function open(item: ScanItem) {
    const backup = beforeOpen.current;
    if (backup?.path === item.path) {
      interrupt();
      save(backup.entries);
      anchor.current = backup.anchor;
    }
    beforeOpen.current = null;
  }
  const items = useMemo(() => [...entries.values()].map((e) => e.item), [entries]);
  const paths = useMemo(() => new Set(entries.keys()), [entries]);
  const roots = useMemo(() => rootsOf(items), [items]);
  return { items, paths, roots, loading, pick, page, clear, remove, open };
}
export type Selection = ReturnType<typeof useSelection>;
