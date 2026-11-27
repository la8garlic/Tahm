import { tr, locale, nativeMessage } from "./i18n";
import { Folder, File, Trash2, X, RotateCw, ListChecks } from "lucide-react";
import { useState } from "react";
import { ActivityBar, basename, bytes, count, Dialog, ScanBar } from "./shared";
import * as ipc from "./ipc.js";

import { useEstimate } from "./selection";
export function Queue({
  generation,
  items,
  outcomes,
  pending,
  progress,
  refreshing,
  scanProgress,
  expectedFiles,
  review,
  remove,
  recycle,
  close,
  run,
  message,
}: {
  generation: number | null;
  items: ScanItem[];
  outcomes: RecycleResult[];
  pending: boolean;
  progress: RecycleProgress | null;
  refreshing: boolean;
  scanProgress: ProgressUpdate | null;
  expectedFiles: number;
  review: (path: string) => void;
  remove: (s: string) => void;
  recycle: () => void;
  close: () => void;
  run: (op: () => Promise<unknown>) => void;
  message: string;
}) {
  const size = items.reduce((n, i) => n + i.bytes, 0);
  const [revision, refresh] = useState(0);
  const paths = items.map((i) => i.path);
  const estimate = useEstimate(generation, paths, revision, run);
  const finished = outcomes.length > 0 && !items.length;
  if (!items.length && !finished && !pending && !refreshing && !message)
    return (
      <Dialog title={tr("待清理清单")} close={close}>
        <div className="queue-empty">
          <ListChecks />
          <h3>{tr("清单为空")}</h3>
          <p>{tr("在扫描结果中勾选文件或文件夹，再点击「加入待清理」。")}</p>
        </div>
        <div className="dialog-actions">
          <button onClick={() => run(ipc.openBin)}>{tr("打开系统回收站")}</button>
          <button className="primary" onClick={close}>
            {tr("返回")}
          </button>
        </div>
      </Dialog>
    );
  const checked = progress?.phase === "verify" && progress.files > 0;
  const phase = refreshing
    ? tr("正在刷新扫描结果")
    : progress?.phase === "shell"
      ? tr("Windows 正在移入回收站")
      : tr("正在复核");
  return (
    <Dialog title={tr("待清理清单")} close={close} locked={pending}>
      {finished ? (
        <div className="queue-total">
          <Trash2 />
          <div>
            <small>{tr("本次清理结果")}</small>
            <strong>{tr("已移入 {0} 项", count(outcomes.filter((o) => !o.error).length))}</strong>
            <small>{tr("未移入 {0} 项", count(outcomes.filter((o) => o.error).length))}</small>
          </div>
        </div>
      ) : (
        <div className="queue-total">
          <Trash2 />
          <div>
            <small>{tr("清空回收站后，本清单预计释放")}</small>
            <strong
              title={
                estimate?.value
                  ? tr("{0} 字节", estimate.value.reclaimable.toLocaleString(locale()))
                  : undefined
              }
            >
              {!items.length
                ? "0 B"
                : estimate?.error
                  ? tr("估算不可用")
                  : estimate?.value
                    ? bytes(estimate.value.reclaimable)
                    : tr("核算中…")}
            </strong>
            <small>{tr("{0} 项待处理 · 逻辑大小 {1}", items.length, bytes(size))}</small>
          </div>
          {items.length > 0 && (
            <button
              className="icon"
              aria-label={tr("刷新释放估算")}
              title={tr("重新核对文件与硬链接")}
              disabled={pending || !estimate}
              onClick={() => refresh(revision + 1)}
            >
              <RotateCw />
            </button>
          )}
        </div>
      )}
      {(pending || refreshing) && (
        <section className="recycle-progress" aria-label={tr("清理进度")}>
          <div>
            <b>{phase}</b>
            {!refreshing && progress && (
              <span>{tr("第 {0} / {1} 项", count(progress.index), count(progress.total))}</span>
            )}
          </div>
          {refreshing ? (
            <ScanBar files={scanProgress?.files ?? 0} expected={expectedFiles} />
          ) : (
            <ActivityBar
              label={phase}
              fraction={
                checked && progress && progress.checked > 0
                  ? progress.checked / progress.files
                  : undefined
              }
            />
          )}
          <small>
            {refreshing
              ? scanProgress
                ? tr("已扫描 {0} 个文件", count(scanProgress.files))
                : tr("正在枚举目录…")
              : checked && progress
                ? tr("已核对 {0} / {1} 个文件", count(progress.checked), count(progress.files))
                : progress?.phase === "shell"
                  ? tr("等待 Windows 返回操作结果")
                  : tr("正在核对目录项…")}
          </small>
          <small className="current-path" title={refreshing ? scanProgress?.path : progress?.path}>
            {refreshing ? scanProgress?.path : progress?.path}
          </small>
        </section>
      )}
      {!pending && !refreshing && items.length > 0 && !estimate && (
        <ActivityBar label={tr("正在核算清单占用")} />
      )}
      {estimate?.error && <p className="error">{estimate.error}</p>}
      {estimate?.value && (
        <div className="disk-note">
          {estimate.value.retained_files > 0 && (
            <p>
              {tr(
                "仍有清单外硬链接的文件共 {0} 个，{1} 将继续占用磁盘。",
                estimate.value.retained_files,
                bytes(estimate.value.retained),
              )}
            </p>
          )}
          {estimate.value.unknown > 0 && (
            <p>{tr("有 {0} 个文件无法核实，仅显示已确认部分。", estimate.value.unknown)}</p>
          )}
          {estimate.value.blocked.map((r) => (
            <p key={r.path} className="error">
              {tr("未计入 · {0} · {1}", r.path, nativeMessage(r.error!))}
            </p>
          ))}
          {tr("估算按当前文件主数据流计算，忽略目录元数据及回收站原有项目。")}
        </div>
      )}
      <div className="queue-list">
        {items.map((i) => (
          <div key={i.path}>
            {i.directory ? <Folder /> : <File />}
            <div>
              <b>{basename(i.path)}</b>
              <small>{i.path}</small>
            </div>
            <span>{bytes(i.bytes)}</span>
            <button
              className="icon"
              disabled={pending}
              aria-label={tr("移出 {0}", basename(i.path))}
              onClick={() => remove(i.path)}
            >
              <X />
            </button>
          </div>
        ))}
      </div>
      {outcomes.map((o) => (
        <div key={o.path} className={o.error ? "error recycle-result" : "notice recycle-result"}>
          <b>{o.error ? tr("未移入") : tr("已移入回收站")}</b> · {o.path}
          {o.error && <small>{nativeMessage(o.error)}</small>}
          {o.error && (
            <button disabled={pending || refreshing} onClick={() => review(o.path)}>
              {tr("重新扫描并定位")}
            </button>
          )}
        </div>
      ))}
      <p role="status">{message || tr("确认后，所列项目及其中的文件将移入 Windows 回收站。")}</p>
      <div className="dialog-actions">
        <button onClick={() => run(ipc.openBin)}>{tr("打开系统回收站")}</button>
        {finished ? (
          <button className="primary" disabled={pending || refreshing} onClick={close}>
            {tr("完成")}
          </button>
        ) : (
          <button
            id="recycle"
            className="danger"
            disabled={!items.length || pending || !estimate}
            onClick={recycle}
          >
            <Trash2 />
            {pending ? tr("正在处理…") : tr("确认移入回收站")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
