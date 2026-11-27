import { tr, nativeMessage } from "./i18n";
import { useState } from "react";
import { ListPlus, ListChecks, RotateCw, X } from "lucide-react";
import { bytes, basename, Dialog, count } from "./shared";
import { covering, type Selection } from "./selection";

type Props = {
  selection: Selection;
  estimate?: ReclaimEstimate | null;
  error?: string;
  refresh: () => void;
  stage: () => void;
  busy: boolean;
  queued: boolean;
  issues: RecycleResult[];
  locate: (i: ScanItem) => void;
};
export function SelectionBar({
  selection: s,
  estimate,
  error,
  refresh,
  stage,
  busy,
  queued,
  issues,
  locate,
}: Props) {
  const [review, setReview] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  if (!s.items.length)
    return (
      <div className="selection-help">
        <ListChecks />
        <span>
          <kbd>Ctrl</kbd>
          {tr(" 点选 · ")}
          <kbd>Shift</kbd>
          {tr(" 连选 · 跨目录保留选区")}
        </span>
      </div>
    );
  const partial = Boolean(estimate && (estimate.unknown || estimate.blocked.length));
  const blocked = new Map(
    [...(estimate?.blocked ?? []), ...issues]
      .filter((i) => s.paths.has(i.path))
      .map((i) => [i.path, i.error]),
  );
  const label = (v: number) => bytes(v) + (partial ? "*" : "");
  const matches = review
    ? s.items.filter((i) => i.path.toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  const offset = Math.min(page, Math.max(0, Math.ceil(matches.length / 50) - 1)) * 50;
  return (
    <section className="selection-bar" aria-label={tr("跨目录选区")}>
      <div className="selection-line">
        <button
          className="summary-open"
          onClick={() => {
            setQuery("");
            setPage(0);
            setReview(true);
          }}
        >
          <ListChecks />
          {tr("已选 {0} 项", count(s.items.length))}
        </button>
        <span>
          {tr("合计占用 ")}
          <strong
            data-space="occupied"
            title={
              estimate
                ? tr("{0} 字节", String(estimate.retained + estimate.reclaimable))
                : undefined
            }
          >
            {estimate
              ? label(estimate.retained + estimate.reclaimable)
              : error
                ? tr("不可用")
                : tr("核算中…")}
          </strong>
        </span>
        <span>
          {tr("预计释放 ")}
          <strong
            data-space="release"
            title={estimate ? tr("{0} 字节", String(estimate.reclaimable)) : undefined}
          >
            {estimate ? label(estimate.reclaimable) : error ? tr("不可用") : tr("核算中…")}
          </strong>
        </span>
        <button
          className="primary"
          data-action="stage-selection"
          disabled={busy || s.loading || queued}
          onClick={stage}
        >
          <ListPlus />
          {busy ? tr("正在入单…") : queued ? tr("已在清单") : tr("加入待清理")}
        </button>
        <button
          className="icon"
          aria-label={tr("清除选区")}
          title={tr("清除选区")}
          onClick={s.clear}
        >
          <X />
        </button>
      </div>
      <div className="selection-note" role="status">
        {s.loading
          ? tr("正在读取跨页范围…")
          : s.roots.length < s.items.length
            ? tr("已合并父子项，按 {0} 个顶层项目核算。", count(s.roots.length))
            : tr("清空回收站后的预计释放量。")}
        {estimate &&
          estimate.retained_files > 0 &&
          tr(" 外部硬链接保留 {0}。", bytes(estimate.retained))}
        {partial && tr(" * 仅计入可核实的项目。")}
        {error && " " + error}
        {blocked.size > 0 && (
          <button
            onClick={() => {
              setReview(true);
              setPage(0);
              setQuery("");
            }}
          >
            {tr("查看 {0} 项提示", count(blocked.size))}
          </button>
        )}
        <button
          className="icon"
          title={tr("重新核算选区")}
          aria-label={tr("重新核算选区")}
          onClick={refresh}
        >
          <RotateCw />
        </button>
      </div>
      {review && (
        <Dialog title={tr("已选项目")} close={() => setReview(false)}>
          <input
            type="search"
            aria-label={tr("筛选选中路径")}
            placeholder={tr("按完整路径筛选")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
          <div className="queue-list">
            {matches.slice(offset, offset + 50).map((i) => {
              const parent = covering(s.paths, i.path, false);
              return (
                <div key={i.path}>
                  <div>
                    <b>{basename(i.path)}</b>
                    <small>{i.path}</small>
                    {parent && <small>{tr("随上级目录合并统计")}</small>}
                    {blocked.has(i.path) && (
                      <small className="error">{nativeMessage(blocked.get(i.path)!)}</small>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setReview(false);
                      locate(i);
                    }}
                  >
                    {tr("定位")}
                  </button>
                  <button
                    aria-label={tr("取消选择 {0}", basename(i.path))}
                    onClick={() => {
                      if (s.items.length === 1) setReview(false);
                      s.remove(i.path);
                    }}
                  >
                    <X />
                  </button>
                </div>
              );
            })}
          </div>
          {!matches.length && <p className="empty">{tr("没有匹配的选中项目")}</p>}
          <div className="pager">
            <small>{tr("{0} 项", count(matches.length))}</small>
            <button disabled={!offset} onClick={() => setPage(offset / 50 - 1)}>
              {tr("上一页")}
            </button>
            <button
              disabled={offset + 50 >= matches.length}
              onClick={() => setPage(offset / 50 + 1)}
            >
              {tr("下一页")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
