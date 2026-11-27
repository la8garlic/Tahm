import { tr, label, nativeMessage, useNotice } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  ArrowDownToLine,
  Boxes,
  Check,
  CircleAlert,
  Clock3,
  Database,
  FileSearch,
  Files,
  Folder,
  FolderOpen,
  FolderSearch,
  HardDrive,
  History,
  House,
  Layers3,
  ListChecks,
  LoaderCircle,
  PieChart,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { Home } from "./Home";
import { Workspace, titles, type Screen } from "./Workspace";
import { Queue } from "./Queue";
import { contains, covering, rootsOf } from "./selection";
import { clearHistory, readHistory, record, type Snapshot } from "./history";
import { basename, bytes, count, Dialog, parent, ScanBar } from "./shared";
import * as ipc from "./ipc.js";

const navigation = [
  ["children", Layers3],
  ["types", PieChart],
  ["files", FileSearch],
  ["folders", Boxes],
  ["old", Clock3],
  ["compare", History],
  ["reviews", ListChecks],
] as const;
export function App() {
  const [report, setReport] = useState<ScanReport | null>(null),
    [home, setHome] = useState(true),
    [view, setView] = useState<Screen>("children");
  const [path, setPath] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const operating = useRef(false),
    generation = useRef(0);
  const [status, setStatus] = useNotice(() => tr("准备就绪")),
    [error, setError] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]),
    [previous, setPrevious] = useState<Snapshot>();
  const historyRef = useRef<Snapshot[]>([]);
  const [queue, setQueue] = useState<ScanItem[]>([]),
    queueRef = useRef<ScanItem[]>([]);
  const [kept, setKept] = useState<string[]>([]),
    keptRef = useRef<string[]>([]);
  const [panel, setPanel] = useState<"queue" | "rescan" | "history" | null>(null);
  const [planned, setPlanned] = useState(""),
    [recycling, setRecycling] = useState(false);
  const [outcomes, setOutcomes] = useState<RecycleResult[]>([]),
    [message, setMessage] = useNotice();
  const pendingRecycle = useRef(false);
  const [recycleProgress, setRecycleProgress] = useState<RecycleProgress | null>(null);
  const [initialFocus, setInitialFocus] = useState<string | null>(null);
  const [expectedFiles, setExpectedFiles] = useState(0);
  function entries(items: ScanItem[]) {
    queueRef.current = items;
    setQueue(items);
  }
  function retain(paths: string[]) {
    keptRef.current = paths;
    setKept(paths);
  }
  function notify(s: () => string, err = false) {
    setError(err);
    setStatus(s);
  }
  function run(op: () => Promise<unknown>) {
    void op().catch((e) => notify(() => nativeMessage(String(e)), true));
  }
  function go(v: Screen) {
    setHome(false);
    setView(v);
  }
  async function scan(
    input: string,
    after = false,
    focus: string | null = null,
    expected = report?.root === input ? report.totals.files : 0,
  ) {
    if (operating.current || pendingRecycle.current) return;
    operating.current = true;
    setBusy(true);
    setPath(input);
    setProgress(null);
    setExpectedFiles(expected);
    notify(() => tr("正在扫描…"));
    try {
      const data = await ipc.analyze(input, setProgress);
      if (!data) {
        notify(() => tr("扫描已取消"));
        return;
      }
      generation.current = data.generation;
      entries([]);
      retain([]);
      if (!after) {
        setOutcomes([]);
        setMessage(() => "");
      }
      setPrevious(historyRef.current.find((h) => h.root === data.root));
      setReport(data);
      setInitialFocus(focus);
      setPath(data.root);
      go("children");
      notify(() =>
        tr(
          "扫描完成 · {0} 个文件 · {1} 秒",
          count(data.totals.files),
          (data.elapsed_ms / 1000).toFixed(2),
        ),
      );
      try {
        historyRef.current = record(data, historyRef.current);
        setHistory(historyRef.current);
      } catch (e) {
        notify(() => tr("扫描完成，历史记录写入失败 · {0}", String(e)), true);
      }
    } finally {
      operating.current = false;
      setBusy(false);
      setProgress(null);
    }
  }
  function request(input: string) {
    if (queueRef.current.length) {
      setPlanned(input);
      setPanel("rescan");
    } else run(() => scan(input));
  }
  async function choose() {
    const p = await ipc.chooseFolder();
    if (p) request(p);
  }
  useEffect(() => {
    try {
      historyRef.current = readHistory();
      setHistory(historyRef.current);
    } catch (e) {
      notify(() => nativeMessage(String(e)), true);
    }
    run(async () => {
      const initial = await ipc.initialFolder();
      if (initial) await scan(initial);
    });
  }, []);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if (document.querySelector("dialog[open]") || busy || recycling) return;
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        run(choose);
      }
      if (e.ctrlKey && e.key.toLowerCase() === "f" && report) {
        e.preventDefault();
        go("files");
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>("#find-name")?.focus(),
        );
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [busy, recycling, report]);
  const queuedPaths = useMemo(() => new Set(queue.map((i) => i.path)), [queue]);
  const keptPaths = useMemo(() => new Set(kept), [kept]);
  function itemState(p: string) {
    if (covering(keptPaths, p)) return "已保留";
    return covering(queuedPaths, p) ? "待清理" : "";
  }
  async function stage(items: ScanItem[]): Promise<RecycleResult[]> {
    const scanId = generation.current;
    const roots = rootsOf(items);
    const existing = new Set(queueRef.current.map((i) => i.path));
    const pending = roots.filter((i) => !covering(existing, i.path));
    const checks = pending.length
      ? await ipc.checkCandidates(
          scanId,
          pending.map((i) => i.path),
        )
      : [];
    if (scanId !== generation.current || operating.current || pendingRecycle.current)
      throw Error("扫描或清理状态已改变，请重新选择。");
    const errors = new Map(checks.map((r) => [r.path, r.error]));
    const queued = new Set(queueRef.current.map((i) => i.path));
    const accepted: ScanItem[] = [],
      failures: RecycleResult[] = [];
    for (const i of pending) {
      if (covering(queued, i.path)) continue;
      const error =
        errors.get(i.path) ||
        (keptRef.current.some((k) => contains(k, i.path) || contains(i.path, k))
          ? "与本次保留的项目重叠，请先取消保留。"
          : null);
      if (error) failures.push({ path: i.path, error });
      else accepted.push(i);
    }
    if (accepted.length) {
      entries(rootsOf([...queueRef.current, ...accepted]));
      setOutcomes([]);
      setMessage(() => "");
    }
    const skipped = roots.length - accepted.length - failures.length;
    notify(
      () =>
        tr("已加入 {0} 项", accepted.length) +
        (skipped ? tr(" · 清单已有 {0} 项", skipped) : "") +
        (failures.length
          ? tr(
              " · 未加入 {0} 项 · {1} · {2}",
              failures.length,
              failures[0]!.path,
              nativeMessage(failures[0]!.error!),
            )
          : ""),
      failures.length > 0,
    );
    return failures;
  }
  function keep(path: string) {
    if (queueRef.current.some((i) => contains(i.path, path) || contains(path, i.path))) {
      notify(() => tr("请先从清单中移出重叠的项目。"), true);
      return;
    }
    if (kept.includes(path)) retain(kept.filter((k) => k !== path));
    else if (kept.some((k) => contains(k, path))) notify(() => tr("上级目录已保留。"), true);
    else retain([...kept, path]);
  }
  async function recycle() {
    if (pendingRecycle.current || operating.current) return;
    pendingRecycle.current = true;
    setRecycling(true);
    setRecycleProgress(null);
    setOutcomes([]);
    setMessage(() => tr("正在核对快照并逐项移入回收站…"));
    try {
      const submitted = queueRef.current;
      const result = await ipc.recycleItems(
        generation.current,
        submitted.map((i) => i.path),
        setRecycleProgress,
      );
      setOutcomes(result);
      entries([]);
      const ok = result.filter((r) => r.error === null).length;
      const msg = () => tr("已移入 {0} 项，未移入 {1} 项。", ok, result.length - ok);
      setMessage(msg);
      notify(msg);
      if (ok && report) {
        const root = report.root;
        generation.current = 0;
        setReport(null);
        setHome(true);
        pendingRecycle.current = false;
        const moved = new Set(result.filter((r) => r.error === null).map((r) => r.path));
        const removedFiles = submitted.reduce((n, i) => n + (moved.has(i.path) ? i.files : 0), 0);
        await scan(root, true, null, report.totals.files - removedFiles);
      }
    } catch (e) {
      setMessage(() => nativeMessage(String(e)));
      notify(() => nativeMessage(String(e)), true);
    } finally {
      pendingRecycle.current = false;
      setRecycling(false);
      setRecycleProgress(null);
    }
  }
  const stats =
    report &&
    ([
      {
        label: tr("逻辑大小"),
        value: bytes(report.totals.bytes),
        icon: Database,
        screen: "types",
        tint: "jade",
      },
      {
        label: tr("文件数"),
        value: count(report.totals.files),
        icon: Files,
        screen: "files",
        tint: "blue",
      },
      {
        label: tr("子目录"),
        value: count(report.totals.folders),
        icon: Folder,
        screen: "folders",
        tint: "gold",
      },
      {
        label: tr("待复核项目"),
        value: count(report.review_count),
        icon: ListChecks,
        screen: "reviews",
        tint: "violet",
      },
    ] as const);
  return (
    <div className="shell">
      <aside className="rail" inert={busy || recycling}>
        <nav aria-label={tr("工作区")}>
          <button
            title={tr("扫描中心")}
            aria-current={home ? "page" : undefined}
            className={home ? "active" : ""}
            onClick={() => setHome(true)}
          >
            <House />
            <span>{tr("扫描中心")}</span>
          </button>
          <h3>{tr("空间分析")}</h3>
          {navigation.map(([id, Icon]) => (
            <button
              data-view={id}
              title={label(titles[id])}
              key={id}
              disabled={!report}
              aria-current={!home && view === id ? "page" : undefined}
              className={!home && view === id ? "active" : ""}
              onClick={() => go(id)}
            >
              <Icon />
              <span>{label(titles[id])}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          <button id="queue-open" title={tr("待清理清单")} onClick={() => setPanel("queue")}>
            <Archive />
            <span>{tr("待清理清单")}</span>
            <b>{queue.length}</b>
          </button>
          <button title={tr("系统回收站")} onClick={() => run(ipc.openBin)}>
            <Trash2 />
            <span>{tr("系统回收站")}</span>
          </button>
        </div>
      </aside>
      <main>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            const p = path.trim().replace(/^"(.*)"$/, "$1");
            if (p) request(p);
            else run(choose);
          }}
        >
          <label className="address">
            <FolderSearch />
            <input
              aria-label={tr("扫描位置")}
              spellCheck={false}
              value={path}
              placeholder={tr("输入磁盘或文件夹路径")}
              disabled={busy || recycling}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || recycling}
            onClick={() => run(choose)}
            title={tr("浏览文件夹 (Ctrl+O)")}
          >
            <FolderOpen />
            {tr("浏览")}
          </button>
          {busy ? (
            <button type="button" onClick={() => run(ipc.cancelScan)} disabled={recycling}>
              <Square />
              {tr("取消")}
            </button>
          ) : (
            <button className="primary" disabled={recycling}>
              <Play />
              {tr("扫描")}
            </button>
          )}
        </form>
        <div className="scrollbody" inert={busy || recycling}>
          {home && (
            <Home
              history={history}
              clear={() => setPanel("history")}
              scan={request}
              choose={() => run(choose)}
            />
          )}
          {report && (
            <div hidden={home} className="report">
              <header className="report-head">
                <div>
                  <h1>
                    {home || view === "children" ? basename(report.root) : label(titles[view])}
                  </h1>
                  <p title={report.root}>{report.root}</p>
                </div>
                <div className="report-actions">
                  <button
                    title={tr("重新扫描")}
                    aria-label={tr("重新扫描")}
                    onClick={() => request(report.root)}
                  >
                    <RotateCw />
                  </button>
                  <button
                    onClick={() =>
                      run(async () => {
                        const target = await ipc.exportReport(report);
                        if (target) notify(() => tr("报告已保存 · {0}", target));
                      })
                    }
                  >
                    <ArrowDownToLine />
                    {tr("导出报告")}
                  </button>
                </div>
              </header>
              <div className="metrics">
                <div
                  className="metric physical"
                  title={tr("文件主数据流的已分配空间，扫描范围内的硬链接只统计一次")}
                >
                  <span>
                    <HardDrive />
                    {tr("磁盘占用")}
                    {report.root_info.disk.unknown > 0 && tr("（部分）")}
                  </span>
                  <strong>{bytes(report.root_info.disk.charged)}</strong>
                </div>
                {stats?.map((m) => (
                  <button className={"metric " + m.tint} key={m.label} onClick={() => go(m.screen)}>
                    <span>
                      <m.icon />
                      {m.label}
                    </span>
                    <strong>{m.value}</strong>
                  </button>
                ))}
              </div>
              <Workspace
                key={report.generation}
                initialFocus={initialFocus}
                report={report}
                view={view}
                go={go}
                previous={previous}
                rescan={() => request(report.root)}
                state={itemState}
                stage={stage}
                keep={keep}
                run={run}
              />
            </div>
          )}
        </div>
        {busy && (
          <div role="status" className="scan-progress">
            <LoaderCircle className="spin" />
            <div>
              <b>{tr("正在扫描 {0}", basename(path))}</b>
              <ScanBar files={progress?.files ?? 0} expected={expectedFiles} />
              <p>
                {progress
                  ? tr(
                      "{0} 个文件 · {1} · {2}",
                      count(progress.files),
                      bytes(progress.bytes),
                      progress.path,
                    )
                  : tr("正在枚举目录…")}
              </p>
            </div>
          </div>
        )}
        <footer id="status" role="status" className={error ? "error" : ""}>
          {error ? <CircleAlert /> : busy ? <Activity /> : <Check />}
          <span title={status}>{status}</span>
          <small>
            <HardDrive />
            {tr("本机分析")}
          </small>
        </footer>
      </main>
      {panel === "queue" && (
        <Queue
          generation={report?.generation ?? null}
          items={queue}
          pending={recycling}
          progress={recycleProgress}
          refreshing={busy}
          scanProgress={progress}
          expectedFiles={expectedFiles}
          review={(failed) => {
            setPanel(null);
            run(() => scan(report?.root ?? parent(failed), true, failed));
          }}
          outcomes={outcomes}
          message={message}
          close={() => setPanel(null)}
          remove={(p) => entries(queue.filter((i) => i.path !== p))}
          recycle={() => run(recycle)}
          run={run}
        />
      )}
      {panel === "rescan" && (
        <Dialog title={tr("重新扫描此位置？")} close={() => setPanel(null)}>
          <p>{tr("新扫描完成后，当前清单中的 {0} 项将移出待清理清单。", queue.length)}</p>
          <p className="path">{planned}</p>
          <div className="dialog-actions">
            <button onClick={() => setPanel(null)}>{tr("取消")}</button>
            <button
              className="primary"
              onClick={() => {
                setPanel(null);
                run(() => scan(planned));
              }}
            >
              {tr("开始扫描")}
            </button>
          </div>
        </Dialog>
      )}
      {panel === "history" && (
        <Dialog title={tr("清除本机扫描记录？")} close={() => setPanel(null)}>
          <p>{tr("将移除最近扫描的位置及其对比数据。")}</p>
          <div className="dialog-actions">
            <button onClick={() => setPanel(null)}>{tr("取消")}</button>
            <button
              className="primary"
              onClick={() => {
                clearHistory();
                historyRef.current = [];
                setHistory([]);
                setPrevious(undefined);
                setPanel(null);
              }}
            >
              {tr("清除记录")}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
