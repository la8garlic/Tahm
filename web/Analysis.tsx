import { tr, label, locale } from "./i18n";
import { useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Clock3,
  PieChart,
  Search,
  History,
} from "lucide-react";
import { bytes, color, count, percent, basename } from "./shared";
import type { Snapshot } from "./history";
export function Types({ report, open }: { report: ScanReport; open: (name: string) => void }) {
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  const all = report.extensions.filter((e) =>
    (e.name ? "." + e.name : tr("无扩展名")).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const slices = report.types.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  let end = 0;
  const segments = slices.map(([k, v]) => {
    const start = end;
    end += percent(v, report.totals.bytes);
    return color(k) + " " + start + "% " + end + "%";
  });
  return (
    <div className="analysis-grid">
      <section className="card">
        <div className="panel-title">
          <h2>
            <PieChart />
            {tr("文件类型占比")}
          </h2>
        </div>
        <div
          className="donut"
          style={{
            background: segments.length ? "conic-gradient(" + segments.join(",") + ")" : undefined,
          }}
        >
          <div>
            <small>{tr("逻辑大小")}</small>
            <strong>{bytes(report.totals.bytes)}</strong>
          </div>
        </div>
        <div className="type-list">
          {slices.map(([k, v]) => (
            <div key={k}>
              <span>
                <i style={{ background: color(k) }} />
                {label(k)}
              </span>
              <b>{bytes(v)}</b>
              <small>{percent(v, report.totals.bytes).toFixed(1)}%</small>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="panel-title">
          <h2>{tr("扩展名排行")}</h2>
          <span className="tag">{tr("{0} 种", count(report.extensions.length))}</span>
        </div>
        <label className="search">
          <Search />
          <input
            aria-label={tr("筛选扩展名")}
            placeholder={tr("筛选扩展名…")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <table>
          <thead>
            <tr>
              <th>{tr("扩展名")}</th>
              <th>{tr("文件数")}</th>
              <th>{tr("逻辑大小 ↓")}</th>
              <th>{tr("查看文件")}</th>
            </tr>
          </thead>
          <tbody>
            {all.slice(offset, offset + 50).map((e) => (
              <tr key={e.name}>
                <td>
                  <button className="text-btn" onClick={() => open(e.name)}>
                    {e.name ? "." + e.name : tr("无扩展名")}
                  </button>
                </td>
                <td>{count(e.files)}</td>
                <td>{bytes(e.bytes)}</td>
                <td>
                  <button
                    className="icon"
                    aria-label={tr("查找 {0} 文件", e.name || tr("无扩展名"))}
                    onClick={() => open(e.name)}
                  >
                    <ArrowRight />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!all.length && <p className="empty">{tr("没有匹配的扩展名")}</p>}
        <div className="pager">
          <small>{tr("共 {0} 种", count(all.length))}</small>
          <button disabled={!offset} onClick={() => setOffset(offset - 50)}>
            {tr("上一页")}
          </button>
          <button disabled={offset + 50 >= all.length} onClick={() => setOffset(offset + 50)}>
            {tr("下一页")}
          </button>
        </div>
      </section>
    </div>
  );
}
const signed = (n: number, format: (v: number) => string) =>
  (n > 0 ? "+" : n < 0 ? "−" : "") + format(Math.abs(n));
export function Comparison({
  report,
  previous,
  rescan,
}: {
  report: ScanReport;
  previous?: Snapshot;
  rescan: () => void;
}) {
  if (!previous)
    return (
      <section className="card blank">
        <History />
        <h2>{tr("已记录本次扫描")}</h2>
        <p>{tr("下次扫描同一位置后，这里会列出逻辑大小、文件数量和各类型的变化。")}</p>
        <button onClick={rescan}>{tr("重新扫描 {0}", basename(report.root))}</button>
      </section>
    );
  const old = new Map(previous.types);
  return (
    <section className="card comparison">
      <div className="panel-title">
        <h2>
          <Clock3 />
          {tr("与上一次扫描对比")}
        </h2>
      </div>
      <p className="path">
        {tr("{0} · 上次扫描于 {1}", report.root, new Date(previous.time).toLocaleString(locale()))}
      </p>
      <div className="delta">
        <div>
          <small>{tr("逻辑大小变化")}</small>
          <strong>{signed(report.totals.bytes - previous.bytes, bytes)}</strong>
        </div>
        <div>
          <small>{tr("文件变化")}</small>
          <strong>{signed(report.totals.files - previous.files, count)}</strong>
        </div>
        <div>
          <small>{tr("子目录变化")}</small>
          <strong>{signed(report.totals.folders - previous.folders, count)}</strong>
        </div>
      </div>
      {previous.errors + previous.skipped + report.totals.errors + report.totals.skipped > 0 && (
        <p className="notice">{tr("扫描含读取错误或跳过项目，差值仅覆盖已统计内容。")}</p>
      )}
      <table>
        <thead>
          <tr>
            <th>{tr("文件类型")}</th>
            <th>{tr("上次")}</th>
            <th>{tr("本次")}</th>
            <th>{tr("变化")}</th>
          </tr>
        </thead>
        <tbody>
          {report.types
            .map(([k, v]) => ({ k, v, then: old.get(k) ?? 0 }))
            .sort((a, b) => Math.abs(b.v - b.then) - Math.abs(a.v - a.then))
            .map(({ k, v, then }) => (
              <tr key={k}>
                <td>
                  <i className="dot" style={{ background: color(k) }} />
                  {label(k)}
                </td>
                <td>{bytes(then)}</td>
                <td>{bytes(v)}</td>
                <td className={v > then ? "growth" : v < then ? "reduced" : ""}>
                  {v > then ? <ArrowUpRight /> : v < then ? <ArrowDownRight /> : null}
                  {signed(v - then, bytes)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}
