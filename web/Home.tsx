import { useState } from "react";
import { tr, label, locale } from "./i18n";
import {
  ArrowRight,
  Clock3,
  Download,
  FolderOpen,
  HardDrive,
  ListChecks,
  Monitor,
  UserRound,
} from "lucide-react";
import { basename, bytes, count, percent, useData } from "./shared";
import * as ipc from "./ipc.js";
import type { Snapshot } from "./history";

export function Home({
  scan,
  scanForCleanup,
  address,
  choose,
  history,
  clear,
}: {
  scan: (s: string) => void;
  scanForCleanup: (path: string) => void;
  address: string;
  choose: () => void;
  history: Snapshot[];
  clear: () => void;
}) {
  const volumes = useData("volumes", ipc.volumes),
    locations = useData("places", ipc.locations);
  const disks = volumes?.value;
  const [choice, setChoice] = useState("");
  const current = address.trim().replace(/^"(.*)"$/, "$1");
  const scopes = new Map<string, string>();
  if (current) scopes.set(current, current);
  for (const [name, path] of locations?.value ?? []) scopes.set(path, label(name) + " · " + path);
  for (const disk of disks ?? []) scopes.set(disk.path, disk.path);
  // 等待系统返回常用位置；磁盘列表先到达时也不能把默认范围扩大为整盘。
  const target = scopes.has(choice) ? choice : current || locations?.value?.[0]?.[1];
  return (
    <div className="home">
      <header className="home-heading">
        <div>
          <h1>{tr("扫描中心")}</h1>
          <p>{tr("选择磁盘或文件夹，查看文件如何占用空间。")}</p>
        </div>
        <button className="primary" onClick={choose}>
          <FolderOpen />
          {tr("选择文件夹")}
        </button>
      </header>
      <section className="card quick-scan">
        <div>
          <h2>
            <ListChecks />
            {tr("一键扫描清理建议")}
          </h2>
          <p>{tr("查找可重建的目录和需要核对的文件，扫描后由你选择清理项。")}</p>
        </div>
        <label>
          <span>{tr("扫描范围")}</span>
          <select value={target ?? ""} onChange={(e) => setChoice(e.target.value)}>
            {!target && <option value="">{tr("选择扫描范围")}</option>}
            {[...scopes].map(([path, name]) => (
              <option key={path} value={path}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={!target}
          onClick={() => target && scanForCleanup(target)}
        >
          <ListChecks />
          {tr("扫描并查看建议")}
        </button>
      </section>
      <div className="section-title">
        <h2>{tr("磁盘与卷")}</h2>
        <small>{disks ? tr("{0} 个位置", count(disks.length)) : tr("正在读取")}</small>
      </div>
      <div className="volume-grid">
        {disks?.map((d) => {
          const used = percent(d.total - d.free, d.total);
          return (
            <button
              className="disk"
              key={d.path}
              onClick={() => scan(d.path)}
              title={tr("扫描 {0}", d.path)}
            >
              <span className="disk-heading">
                <HardDrive />
                <b>
                  {d.label || tr("本地磁盘")} · {d.path}
                </b>
                <ArrowRight />
              </span>
              <span className="disk-capacity">
                <span>
                  <small>{tr("可用空间")}</small>
                  <strong>{bytes(d.free)}</strong>
                  <small>{tr("总容量 {0}", bytes(d.total))}</small>
                </span>
                {d.total > 0 && (
                  <span
                    className="disk-ring"
                    style={{
                      background: `conic-gradient(var(--capacity-fill) ${used}%, var(--capacity-track) 0)`,
                    }}
                  >
                    <span>
                      <b>{used.toFixed(0)}%</b>
                      <small>{tr("已用")}</small>
                    </span>
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {volumes?.error && <p className="error">{volumes.error}</p>}
        {disks?.length === 0 && <p>{tr("没有可枚举的磁盘，可直接选择文件夹。")}</p>}
      </div>
      <div className="section-title">
        <h2>{tr("常用位置")}</h2>
      </div>
      <div className="places">
        {locations?.value?.map(([name, path], i) => {
          const Icon = [Download, Monitor, UserRound][i] ?? FolderOpen;
          return (
            <button className="card place" key={path} onClick={() => scan(path)}>
              <Icon />
              <div>
                <b>{label(name)}</b>
                <small title={path}>{path}</small>
              </div>
              <ArrowRight />
            </button>
          );
        })}
        {locations?.error && <p className="error">{locations.error}</p>}
      </div>
      <div className="section-title">
        <h2>{tr("最近扫描")}</h2>
        {history.length > 0 && (
          <button className="subtle" onClick={clear}>
            {tr("清除记录")}
          </button>
        )}
      </div>
      <section className="card recents">
        {history.length ? (
          history.map((h) => (
            <button key={h.root} onClick={() => scan(h.root)}>
              <Clock3 />
              <div>
                <b>{basename(h.root)}</b>
                <small>{h.root}</small>
              </div>
              <span>{bytes(h.bytes)}</span>
              <time>{new Date(h.time).toLocaleDateString(locale())}</time>
              <ArrowRight />
            </button>
          ))
        ) : (
          <p className="muted">
            <Clock3 />
            {tr("扫描完成后，可从这里再次打开同一位置。")}
          </p>
        )}
      </section>
      <small className="font-credit">{tr("界面字体使用小米 MiSans")}</small>
    </div>
  );
}
