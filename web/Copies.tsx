import { tr, nativeMessage, useNotice } from "./i18n";
import { useState } from "react";
import { Files, LocateFixed } from "lucide-react";
import { Dialog, bytes, count, basename } from "./shared";
import * as ipc from "./ipc.js";

/** 比对和清理分开操作，副本可能是硬链接或刻意保留的备份。 */
export function Copies({
  item,
  generation,
  locate,
  close,
}: {
  item: ScanItem;
  generation: number;
  locate: (item: ScanItem) => void;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [stopping, setStopping] = useState(false);
  const [status, setStatus] = useNotice(),
    [result, setResult] = useState<CopyReport>();
  async function compare() {
    setBusy(true);
    setStopping(false);
    setResult(undefined);
    setStatus(() => tr("正在查找同尺寸文件…"));
    try {
      const data = await ipc.findCopies(generation, item.path, (p) =>
        setStatus(() => tr("已处理 {0} 项，已比对 {1}", count(p.checked), bytes(p.compared_bytes))),
      );
      setResult(data);
      setStatus(
        () =>
          (data.cancelled ? tr("已取消，") : "") +
          tr(
            "已比对 {0} 项，内容相同 {1} 项，跳过 {2} 项。",
            count(data.checked),
            count(data.matches),
            count(data.skipped),
          ),
      );
    } catch (e) {
      setStatus(() => nativeMessage(String(e)));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={tr("查找相同内容")} close={close} locked={busy}>
      <p className="path">
        {item.path} · {bytes(item.bytes)}
      </p>
      <p>
        {tr("在本次扫描范围内逐字节比对同尺寸文件。相同内容也可能来自硬链接或单独保存的备份。")}
      </p>
      <div className="dialog-actions">
        {busy ? (
          <button
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await ipc.cancelCopies();
              } catch (e) {
                setStopping(false);
                setStatus(() => nativeMessage(String(e)));
              }
            }}
          >
            {stopping ? tr("正在取消…") : tr("取消比对")}
          </button>
        ) : (
          <button className="primary" onClick={() => void compare()}>
            <Files />
            {result ? tr("重新比对") : tr("开始比对")}
          </button>
        )}
      </div>
      <p role="status">{status}</p>
      {result && (
        <>
          {result.matches > result.items.length && (
            <p>{tr("显示最先找到的 {0} 项。", result.items.length)}</p>
          )}
          <div className="queue-list">
            {result.items.map((copy) => (
              <div key={copy.path}>
                <div>
                  <b>{basename(copy.path)}</b>
                  <small>{copy.path}</small>
                </div>
                <button
                  title={tr("在目录中定位")}
                  onClick={() => {
                    close();
                    locate(copy);
                  }}
                >
                  <LocateFixed />
                  {tr("定位")}
                </button>
              </div>
            ))}
          </div>
          {result.issues.length > 0 && (
            <details>
              <summary>{tr("未能比对的项目")}</summary>
              {result.issues.map((e) => (
                <p key={e}>{nativeMessage(e)}</p>
              ))}
            </details>
          )}
        </>
      )}
    </Dialog>
  );
}
