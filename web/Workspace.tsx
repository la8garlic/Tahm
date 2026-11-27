import { tr, label, nativeMessage, locale } from "./i18n";
import { useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  FolderTree,
  ListFilter,
  Search,
} from "lucide-react";
import * as ipc from "./ipc.js";
import { Comparison, Types } from "./Analysis";
import { Inspector, type Reading } from "./Inspector";
import { SelectionBar } from "./SelectionBar";
import { covering, useEstimate, useSelection, type Selection } from "./selection";
import { MapView } from "./MapView";
import {
  ancestors,
  basename,
  bytes,
  color,
  count,
  date,
  emptyReviewReason,
  parent,
  percent,
  useData,
  weight,
} from "./shared";
import type { Snapshot } from "./history";

export type Screen = "children" | "files" | "folders" | "old" | "reviews" | "types" | "compare";
export const titles: Record<Screen, string> = {
  children: "空间浏览",
  files: "查找文件",
  folders: "大目录",
  old: "旧目录",
  reviews: "清理建议",
  types: "文件类型",
  compare: "扫描对比",
};
type Props = {
  initialFocus: string | null;
  report: ScanReport;
  view: Screen;
  go: (v: Screen) => void;
  previous?: Snapshot;
  rescan: () => void;
  state: (path: string) => string;
  stage: (items: ScanItem[]) => Promise<RecycleResult[]>;
  keep: (path: string) => void;
  run: (op: () => Promise<unknown>) => void;
};
type Viewport = { path: string; offset: number; focus: string | null };
function location(path: string, focus: string | null = null) {
  return { path, offset: 0, focus, query: "" };
}
type Reveal = { path: string; target: "rows" | "map"; keepViewport: boolean; directory: boolean };
type RowProps = {
  showAdvice?: boolean;
  selection: Selection;
  scope: string;
  order?: SelectionOrder;
  metric?: SpaceMetric;
  rows: ScanItem[];
  selected: string;
  select: (i: ScanItem, keepViewport: boolean) => void;
  enter: (s: string) => void;
  base: number;
  state: (s: string) => string;
  paths: boolean;
  empty: string;
};
function Items({
  showAdvice = false,
  selection,
  scope,
  order,
  rows,
  selected,
  select,
  enter,
  base,
  state,
  paths,
  empty,
  metric = "logical",
}: RowProps) {
  const surface = { key: scope, rows, order };
  const checked = rows.filter((i) => selection.paths.has(i.path)).length;
  return (
    <div className="table-scroll">
      <table
        className={showAdvice ? "items review-items" : "items"}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            selection.page(surface, false);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            selection.clear();
          }
        }}
      >
        <thead>
          <tr>
            <th>
              <label className="select-page">
                <input
                  type="checkbox"
                  aria-label={tr("选择本页全部项目")}
                  disabled={!rows.length}
                  checked={!!rows.length && checked === rows.length}
                  ref={(el) => {
                    if (el) el.indeterminate = checked > 0 && checked < rows.length;
                  }}
                  onChange={() => selection.page(surface, checked === rows.length)}
                />
                {tr("名称")}
              </label>
            </th>
            <th>{metric === "logical" ? tr("逻辑大小") : tr("磁盘占用")} ↓</th>
            {showAdvice ? (
              <th>{tr("清理依据与条件")}</th>
            ) : (
              <>
                <th>{tr("占比")}</th>
                <th>{tr("修改日期")}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const size = weight(item, metric),
              pct = percent(size, base),
              badge = state(item.path);
            return (
              <tr
                key={item.path}
                aria-selected={selection.paths.has(item.path)}
                data-focused={selected === item.path}
                aria-current={selected === item.path || undefined}
                data-path={item.path}
                onMouseDown={(e) => {
                  if (e.ctrlKey || e.shiftKey || e.metaKey) e.preventDefault();
                }}
                onClick={(e) => {
                  select(item, e.ctrlKey || e.metaKey || e.shiftKey);
                  selection.pick(item, surface, e);
                }}
                onDoubleClick={(e) => {
                  if (item.directory && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    selection.open(item);
                    enter(item.path);
                  }
                }}
              >
                <td>
                  <div className="file-cell">
                    <input
                      type="checkbox"
                      aria-label={tr("选择 {0}", basename(item.path))}
                      checked={selection.paths.has(item.path)}
                      readOnly
                      onDoubleClick={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(item, true);
                        selection.pick(item, surface, e, true);
                      }}
                    />
                    {item.directory ? (
                      <Folder className="folder" />
                    ) : (
                      <File style={{ color: color(item.kind) }} />
                    )}
                    <div>
                      <button className="file-name" title={item.path}>
                        {basename(item.path)}
                      </button>
                      {paths && <small title={item.path}>{parent(item.path)}</small>}
                    </div>
                    {badge && <em>{label(badge)}</em>}
                    {!selection.paths.has(item.path) &&
                      covering(selection.paths, item.path, false) && <em>{tr("随上级")}</em>}
                    {item.directory && (
                      <button
                        className="icon dive"
                        title={tr("进入目录")}
                        aria-label={tr("进入 {0}", basename(item.path))}
                        onClick={(e) => {
                          e.stopPropagation();
                          enter(item.path);
                        }}
                      >
                        <ChevronRight />
                      </button>
                    )}
                  </div>
                </td>
                <td title={metric === "allocated" ? tr("已归入此路径的磁盘占用") : undefined}>
                  {metric === "allocated" && item.disk.unknown
                    ? item.directory
                      ? bytes(size) + "*"
                      : tr("未知")
                    : bytes(size)}
                </td>
                {showAdvice ? (
                  <td className="review-evidence">
                    <strong>{label(item.advice.label)}</strong>
                    <p>{label(item.advice.reason)}</p>
                  </td>
                ) : (
                  <>
                    <td>
                      <div className="share">
                        <i style={{ width: pct + "%", background: color(item.kind) }} />
                      </div>
                      <small>{pct > 0 && pct < 0.1 ? "<0.1" : pct.toFixed(1)}%</small>
                    </td>
                    <td>{date(item.modified)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="empty">{empty}</p>}
    </div>
  );
}
const sizes = () => (
  <>
    <option value={0}>{tr("不限大小")}</option>
    <option value={1048576}>≥ 1 MiB</option>
    <option value={104857600}>≥ 100 MiB</option>
    <option value={1073741824}>≥ 1 GiB</option>
  </>
);
function SearchList({
  view,
  report,
  extension,
  setExt,
  ...props
}: Omit<RowProps, "rows" | "empty" | "base" | "paths" | "scope" | "order"> & {
  view: "files" | "folders" | "reviews" | "old";
  report: ScanReport;
  extension: string | null;
  setExt: (name: string | null) => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState(""),
    [minimum, setMinimum] = useState(0),
    [age, setAge] = useState(365);
  const term = query.trim().toLowerCase();
  const reviewFilter = {
    query: query.trim(),
    category,
    labels: term
      ? Object.keys(report.review_types).filter((key) => label(key).toLowerCase().includes(term))
      : [],
  };
  const filterKey = JSON.stringify([
    report.generation,
    view,
    query,
    category,
    extension,
    minimum,
    age,
    view === "reviews" || view === "folders" ? locale() : null,
  ]);
  const [pages, setPages] = useState<{ key: string; cursors: { bytes: number; path: string }[] }>({
    key: filterKey,
    cursors: [],
  });
  const cursors = pages.key === filterKey ? pages.cursors : [];
  const lookup = useData(
    JSON.stringify([filterKey, cursors.at(-1)]),
    async (): Promise<[number, ScanItem[]]> => {
      if (view === "files" && !query.trim() && extension === null && !minimum && !cursors.length)
        return [report.totals.files, report.files];
      if (view === "files")
        return ipc.findFiles(
          report.generation,
          query.trim(),
          extension,
          minimum,
          cursors.at(-1) ?? null,
        );
      if (view === "old")
        return ipc.oldFolders(
          report.generation,
          Math.floor(Date.now() / 1000) - age * 86400,
          minimum,
          query.trim(),
        );
      if (view === "reviews") {
        if (!term && !category && !cursors.length) return [report.review_count, report.reviews];
        return ipc.findReviews(report.generation, reviewFilter, cursors.at(-1) ?? null);
      }
      const rows = report[view].filter(
        (i) =>
          i.path.toLowerCase().includes(query.trim().toLowerCase()) ||
          label(i.advice.label).toLowerCase().includes(query.trim().toLowerCase()),
      );
      return [rows.length, rows];
    },
    query ? 160 : 0,
  );
  const result = lookup?.value;
  return (
    <section className="card">
      <div className="panel-title">
        <h2>
          <ListFilter />
          {label(titles[view])}
        </h2>
      </div>
      {view === "reviews" && (
        <p className="review-intro">
          {tr(
            "共发现 {0} 项建议。请先核对清理条件，勾选后可查看预计释放空间。",
            count(report.review_count),
          )}
        </p>
      )}
      <div className="filters">
        <label className="search">
          <Search />
          <input
            type="search"
            id="find-name"
            aria-label={tr("查找名称")}
            placeholder={view === "files" ? tr("在所有目录中查找文件名…") : tr("筛选名称或路径…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {view === "reviews" && (
          <select
            aria-label={tr("建议类别")}
            value={category ?? ""}
            onChange={(e) => setCategory(e.target.value || null)}
          >
            <option value="">{tr("全部建议")}</option>
            {Object.entries(report.review_types).map(([key, total]) => (
              <option value={key} key={key}>
                {label(key)} ({count(total)})
              </option>
            ))}
          </select>
        )}
        {(view === "files" || view === "old") && (
          <select
            aria-label={tr("大小下限")}
            value={minimum}
            onChange={(e) => setMinimum(Number(e.target.value))}
          >
            {sizes()}
          </select>
        )}
        {view === "files" && extension !== null && (
          <button onClick={() => setExt(null)}>
            {extension ? "." + extension : tr("无扩展名")} ×
          </button>
        )}
        {view === "old" && (
          <select
            aria-label={tr("最近写入")}
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
          >
            {[90, 180, 365, 1095].map((n) => (
              <option key={n} value={n}>
                {tr("{0} 天前写入", n)}
              </option>
            ))}
          </select>
        )}
      </div>
      <Items
        {...props}
        scope={filterKey}
        order={
          view === "files"
            ? { kind: "files", query: query.trim(), extension, minimum }
            : view === "reviews"
              ? { kind: "reviews", filter: reviewFilter }
              : undefined
        }
        paths
        showAdvice={view === "reviews"}
        rows={result?.[1] ?? []}
        base={report.totals.bytes}
        empty={
          lookup?.error ??
          (result
            ? view === "reviews" && !report.review_count
              ? emptyReviewReason(report)
              : tr("没有匹配的项目")
            : tr("正在查找…"))
        }
      />
      {(view === "files" || view === "reviews") && result ? (
        <div className="pager">
          <small>
            {tr("全扫描范围匹配 {0} 项 · 第 {1} 页", count(result[0]), cursors.length + 1)}
          </small>
          <button
            aria-label={view === "reviews" ? tr("上一页") : tr("上一页文件")}
            disabled={!cursors.length}
            onClick={() => setPages({ key: filterKey, cursors: cursors.slice(0, -1) })}
          >
            <ChevronLeft />
          </button>
          <button
            aria-label={view === "reviews" ? tr("下一页") : tr("下一页文件")}
            disabled={(cursors.length + 1) * 100 >= result[0]}
            onClick={() => {
              const { bytes, path } = result[1].at(-1)!;
              setPages({ key: filterKey, cursors: [...cursors, { bytes, path }] });
            }}
          >
            <ChevronRight />
          </button>
        </div>
      ) : (
        <div className="list-note">
          {view === "folders"
            ? tr("按大小列出前 100 项 · 当前显示 {0} 项", count(result?.[1].length ?? 0))
            : result
              ? tr(
                  "全扫描范围匹配 {0} 项 · 显示最大的 {1} 项",
                  count(result[0]),
                  count(result[1].length),
                )
              : tr("查询当前扫描快照")}
        </div>
      )}
    </section>
  );
}
export function Workspace({
  report,
  initialFocus,
  view,
  go,
  previous,
  rescan,
  state,
  stage,
  keep,
  run,
}: Props) {
  const [loc, setLoc] = useState(() =>
      initialFocus
        ? { ...location(parent(initialFocus)), focus: basename(initialFocus) }
        : location(report.root),
    ),
    [selected, select] = useState<ScanItem | null>(null);
  const [mapLoc, setMapLoc] = useState<Viewport>(loc);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const work = useRef<HTMLDivElement>(null);
  const [extension, setExt] = useState<string | null>(null),
    [mapFirst, setMapFirst] = useState(true);
  // 解读按快照和完整路径复用，切换分析页后仍可查看。
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [fullMap, setFullMap] = useState(false);
  const [metric, setMetric] = useState<SpaceMetric>("logical");
  const selection = useSelection(report.generation, run);
  const [revision, refresh] = useState(0),
    [batchBusy, setBatchBusy] = useState(false),
    [stageIssues, setStageIssues] = useState<RecycleResult[]>([]);
  const estimate = useEstimate(
    report.generation,
    selection.roots.map((i) => i.path),
    revision,
    run,
    160,
  );
  const order: SelectionOrder = { kind: "directory", path: loc.path, query: loc.query, metric };
  const data = useData(
    JSON.stringify([report.generation, loc, metric]),
    () => ipc.folderPage(report.generation, loc.path, loc.query, loc.offset, loc.focus, metric),
    loc.query ? 120 : 0,
  );
  const page = data?.value;
  const chart = useData(JSON.stringify([report.generation, mapLoc, metric]), () =>
    ipc.mapPage(report.generation, mapLoc.path, mapLoc.offset, mapLoc.focus, metric),
  );
  const mapPage = chart?.value;

  useLayoutEffect(() => {
    if (!reveal || !work.current || view !== "children") return;
    const root = work.current;
    const needle = '[data-path="' + CSS.escape(reveal.path) + '"]';
    let target: HTMLElement | null;
    if (reveal.target === "rows") {
      target = root.querySelector<HTMLElement>("tr" + needle);
      if (!target) return;
      const table = target.closest<HTMLElement>(".table-scroll")!;
      const rect = target.getBoundingClientRect(),
        bounds = table.getBoundingClientRect();
      const top = bounds.top + table.querySelector("thead")!.getBoundingClientRect().height;
      if (rect.top < top) table.scrollTop += rect.top - top;
      else if (rect.bottom > bounds.bottom) table.scrollTop += rect.bottom - bounds.bottom;
    } else {
      if (!mapPage) return;
      target =
        root.querySelector<HTMLElement>(".tile" + needle) ??
        root.querySelector<HTMLElement>(".map-linked-note") ??
        root.querySelector<HTMLElement>(".treemap");
    }
    if (!target || fullMap) return;
    if (reveal.keepViewport) {
      setReveal(null);
      return;
    }
    const el = target;
    // 只移动报告滚动层。连续点选保留鼠标位置，目录的第二击仍可进入目录。
    const timer = window.setTimeout(
      () => {
        const scroll = el.closest<HTMLElement>(".scrollbody")!;
        const bounds = scroll.getBoundingClientRect(),
          rect = el.getBoundingClientRect();
        const top =
          bounds.top +
          (scroll.querySelector(".selection-bar")?.getBoundingClientRect().height ?? 0) +
          12;
        if (rect.top < top) scroll.scrollTop += rect.top - top;
        else if (rect.bottom > bounds.bottom - 12)
          scroll.scrollTop += Math.min(rect.top - top, rect.bottom - bounds.bottom + 12);
        setReveal(null);
      },
      reveal.directory ? 500 : 0,
    );
    return () => clearTimeout(timer);
  }, [reveal, page, mapPage, fullMap, view, mapFirst]);

  function link(item: ScanItem, target: "map" | "rows", keepViewport: boolean) {
    select(item);
    const dir = parent(item.path),
      name = basename(item.path);
    if (target === "rows" && (dir !== loc.path || !page?.rows.some((i) => i.path === item.path))) {
      const query =
        dir === loc.path && name.toLowerCase().includes(loc.query.toLowerCase()) ? loc.query : "";
      setLoc({ ...location(dir, name), query });
    }
    // 零面积项和不足一像素的直属项由原图说明，保留当前面积组。
    if (
      target === "map" &&
      !(
        mapPage?.folder.path === dir &&
        (weight(item, metric) === 0 || mapPage.tiles.some((i) => i.path === item.path))
      ) &&
      !work.current?.querySelector('.tile[data-path="' + CSS.escape(item.path) + '"]')
    ) {
      setMapLoc(location(dir, name));
    }
    setReveal({
      path: item.path,
      target,
      keepViewport: keepViewport && !fullMap,
      directory: item.directory,
    });
  }
  function browse(path: string, focus: string | null = null) {
    setReveal(null);
    setLoc(location(path, focus));
    setMapLoc(location(path, focus));
    go("children");
  }
  function enter(path: string) {
    select(null);
    browse(path);
  }
  const located =
    loc.focus && initialFocus
      ? page?.rows.find((i) => i.path === initialFocus && basename(i.path) === loc.focus)
      : undefined;
  const item = selected ?? located ?? page?.folder ?? report.root_info;
  const showInspector = view !== "reviews" || selected?.advice.review;
  const readingKey = JSON.stringify([item.path, locale()]);
  function locate(item: ScanItem) {
    setFullMap(false);
    if (item.path === report.root) {
      enter(report.root);
      return;
    }
    select(item);
    browse(parent(item.path), basename(item.path));
    setReveal({ path: item.path, target: "rows", keepViewport: false, directory: false });
  }
  const bar = (
    <SelectionBar
      selection={selection}
      estimate={estimate?.value}
      error={estimate?.error}
      refresh={() => refresh((n) => n + 1)}
      busy={batchBusy}
      queued={selection.roots.every((i) => state(i.path) === "待清理")}
      issues={stageIssues}
      stage={() =>
        run(async () => {
          setBatchBusy(true);
          try {
            setStageIssues(await stage(selection.roots));
          } finally {
            setBatchBusy(false);
          }
        })
      }
      locate={locate}
    />
  );
  const crumbs = ancestors(report.root, loc.path);
  if (view === "types")
    return (
      <>
        {bar}
        <Types
          report={report}
          open={(name) => {
            setExt(name);
            go("files");
          }}
        />
      </>
    );
  if (view === "compare")
    return (
      <>
        {bar}
        <Comparison report={report} previous={previous} rescan={rescan} />
      </>
    );
  const rows = (
    <section className="card">
      <div className="panel-title">
        <h2>
          <FolderTree />
          {tr("目录明细")}
        </h2>
        <label className="search compact">
          <Search />
          <input
            type="search"
            aria-label={tr("筛选当前目录")}
            placeholder={tr("筛选名称")}
            value={loc.query}
            onChange={(e) => {
              setReveal(null);
              setLoc({ ...loc, query: e.target.value, offset: 0, focus: null });
            }}
          />
        </label>
      </div>
      <Items
        selection={selection}
        scope={JSON.stringify(order)}
        order={order}
        rows={page?.rows ?? []}
        selected={item.path}
        select={(i, keep) => link(i, "map", keep)}
        enter={enter}
        metric={metric}
        base={page ? weight(page.folder, metric) : 0}
        state={state}
        paths={false}
        empty={data?.error ?? (page ? tr("没有匹配的项目") : tr("正在读取目录…"))}
      />
      {page && (
        <div className="pager">
          <small>
            {tr(
              "{0}–{1} / {2} 项",
              page.matches ? page.offset + 1 : 0,
              page.offset + page.rows.length,
              count(page.matches),
            )}
          </small>
          <button
            aria-label={tr("上一页")}
            disabled={!page.offset}
            onClick={() => {
              setReveal(null);
              setLoc({ ...loc, focus: null, offset: page.offset - 100 });
            }}
          >
            <ChevronLeft />
          </button>
          <button
            aria-label={tr("下一页")}
            disabled={page.offset + 100 >= page.matches}
            onClick={() => {
              setReveal(null);
              setLoc({ ...loc, focus: null, offset: page.offset + 100 });
            }}
          >
            <ChevronRight />
          </button>
        </div>
      )}
    </section>
  );
  const map = mapPage ? (
    <MapView
      openFolder={(path) => run(() => ipc.openFolder(path))}
      selection={selection}
      toolbar={bar}
      metric={metric}
      switchMetric={(next) => {
        if (next === metric) return;
        setReveal(null);
        setMetric(next);
        const linked = selected && parent(selected.path) === loc.path ? selected : null;
        const name = linked ? basename(linked.path) : loc.focus;
        setLoc({ ...loc, offset: 0, focus: name });
        setMapLoc(location(linked ? loc.path : mapLoc.path, linked ? name : mapLoc.focus));
      }}
      full={fullMap}
      setFull={setFullMap}
      page={mapPage}
      selected={item}
      detailPath={loc.path}
      select={(i, keep) => link(i, "rows", keep)}
      enter={enter}
      turn={(offset) => {
        setReveal(null);
        setMapLoc({ ...mapLoc, offset, focus: null });
      }}
    />
  ) : (
    <section className="card map-loading" role="status">
      {chart?.error ?? tr("正在读取面积图…")}
    </section>
  );
  return (
    <>
      {!fullMap && bar}
      <div className={showInspector ? "workspace-grid" : "work"}>
        <div className="work" ref={work}>
          {view === "children" ? (
            <>
              <div className="browse-tools">
                <nav className="crumbs" aria-label={tr("当前目录")}>
                  {crumbs.map((p) => (
                    <button title={p} key={p} onClick={() => enter(p)}>
                      {basename(p)}
                      <ChevronRight />
                    </button>
                  ))}
                </nav>
                {page && page.dirs.length > 0 && (
                  <select
                    className="directory-jump"
                    aria-label={tr("跳转到子目录")}
                    value=""
                    onChange={(e) => enter(e.target.value)}
                  >
                    <option value="" disabled>
                      {tr("子目录 ▾")}
                    </option>
                    {page.dirs.map((d) => (
                      <option value={d.path} key={d.path}>
                        {basename(d.path)}
                      </option>
                    ))}
                  </select>
                )}
                <button onClick={() => setMapFirst(!mapFirst)}>
                  {mapFirst ? tr("列表优先") : tr("面积图优先")}
                </button>
              </div>
              {mapFirst ? (
                <>
                  {map}
                  {rows}
                </>
              ) : (
                <>
                  {rows}
                  {map}
                </>
              )}
            </>
          ) : (
            <SearchList
              selection={selection}
              key={view}
              view={view}
              report={report}
              extension={extension}
              setExt={setExt}
              selected={item.path}
              select={(i) => select(i)}
              enter={(path) => {
                enter(path);
              }}
              state={state}
            />
          )}
        </div>
        {showInspector && (
          <Inspector
            item={item}
            report={report}
            reading={readings[readingKey]}
            save={(r) => setReadings((prev) => ({ ...prev, [readingKey]: r }))}
            state={state(item.path)}
            stage={selection.items.length ? undefined : () => run(() => stage([item]))}
            keep={() => keep(item.path)}
            enter={() => enter(item.path)}
            locate={() => locate(item)}
            locateCopy={locate}
            run={run}
          />
        )}
      </div>
      <details className="scope">
        <summary>
          <Archive />
          {tr(
            "统计范围 · 跳过 {0} 项 · 读取错误 {1} 处",
            count(report.totals.skipped),
            count(report.totals.errors),
          )}
        </summary>
        <p>
          {tr(
            "逻辑大小按名称累计。磁盘占用统计文件主数据流的已分配空间，共享的硬链接只归入扫描首次遇到的路径。扫描中有 {0} 个文件的占用未能读取。",
            report.root_info.disk.unknown,
          )}
        </p>
        {report.issues.map((e, i) => (
          <p key={i}>{nativeMessage(e)}</p>
        ))}
      </details>
    </>
  );
}
