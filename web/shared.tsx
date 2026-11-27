import { label, tr, locale, nativeMessage } from "./i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { TitleBar } from "./TitleBar";
export { bytes, basename } from "./ui.js";

export function emptyReviewReason(report: ScanReport) {
  return tr(
    "没有可建议清理的子项目。{0}",
    report.root_info.advice.review
      ? tr("要复核扫描起点本身，请扫描它的上一级目录。")
      : label(report.root_info.advice.reason),
  );
}

// 面积图、图例和类型排行共用分类色，色块上的白字也要清晰可读。
export const colors = [
  "#3b69a6",
  "#26745d",
  "#7456a1",
  "#975925",
  "#426781",
  "#287382",
  "#515da0",
  "#596b75",
];
export const kinds = ["文档", "图片", "影音", "归档", "程序与依赖", "代码", "磁盘与数据", "其他"];
export const color = (kind: string) => colors[kinds.indexOf(kind)] ?? "#596b75";
export const count = (n: number) => n.toLocaleString(locale());
export const date = (t: number | null) =>
  t === null ? "—" : new Date(t * 1000).toLocaleDateString(locale());
export const percent = (n: number, total: number) => (total ? (n / total) * 100 : 0);

/** 自绘前景，确保 WebView2 在总量未知或系统减少动画时也能显出活动色块。 */
export function ActivityBar({ label, fraction }: { label: string; fraction?: number }) {
  return (
    <span
      className="activity-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
    >
      <span
        className={fraction === undefined ? "activity-moving" : "activity-fill"}
        style={fraction === undefined ? undefined : { width: `${fraction * 100}%` }}
      />
    </span>
  );
}

export function ScanBar({ files, expected }: { files: number; expected: number }) {
  // 刷新期间文件仍可增减；超过上次快照的参考值时继续显示活动状态。
  const fraction = files > 0 && files < expected ? files / expected : undefined;
  return (
    <>
      <ActivityBar label={tr("扫描进度")} fraction={fraction} />
      {fraction !== undefined && (
        <small className="scan-percent">
          {tr("按上次快照估算 {0}%", Math.floor(fraction * 100))}
        </small>
      )}
    </>
  );
}
export const weight = (item: ScanItem, metric: SpaceMetric) =>
  metric === "allocated" ? item.disk.charged : item.bytes;
export function parent(path: string) {
  const split = path.lastIndexOf("\\");
  return path.slice(0, split + (path[split - 1] === ":" ? 1 : 0));
}
export function ancestors(root: string, path: string) {
  const parts = [path];
  while (path !== root && path.length > root.length) {
    path = parent(path);
    parts.unshift(path);
  }
  return parts;
}

/** 请求以依赖标识绑定到视图，翻页、切换快照时不会短暂显示上一次的结果。 */
export function useData<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, delay = 0) {
  const [result, setResult] = useState<{ key: string; value?: T; error?: string }>();
  const fetchRef = useRef(fetcher);
  useEffect(() => {
    fetchRef.current = fetcher;
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchRef.current(controller.signal).then(
        (value) => {
          if (!controller.signal.aborted) setResult({ key, value });
        },
        (error) => {
          if (!controller.signal.aborted) setResult({ key, error: String(error) });
        },
      );
    }, delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, delay]);
  if (result?.key !== key) return undefined;
  return result.error ? { ...result, error: nativeMessage(result.error) } : result;
}

export function Dialog({
  title,
  children,
  close,
  locked = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) close();
      }}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <button className="icon" aria-label={tr("关闭")} disabled={locked} onClick={close}>
          <X />
        </button>
      </header>
      {children}
      {/* 原生模态层会让背景不可交互，窗口按钮需位于当前模态层内。 */}
      <TitleBar />
    </dialog>
  );
}
