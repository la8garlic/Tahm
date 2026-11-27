import { tr, label, nativeMessage, sampleLabel, useNotice } from "./i18n";
import { useState } from "react";
import {
  FolderOpen,
  File,
  ListPlus,
  Sparkles,
  ShieldCheck,
  ExternalLink,
  LocateFixed,
  Bookmark,
  ChevronRight,
} from "lucide-react";
import { bytes, basename, date, parent, count, Dialog, useData } from "./shared";
import * as ipc from "./ipc.js";
import { Copies } from "./Copies";

const services = {
  deepseek: ["api.deepseek.com", "DEEPSEEK_API_KEY"],
  openai: ["api.openai.com", "OPENAI_API_KEY"],
  anthropic: ["api.anthropic.com", "ANTHROPIC_API_KEY"],
  local: ["127.0.0.1", ""],
} as const;
const verdicts = {
  keep: "建议保留",
  conditional: "符合条件后可考虑删除",
  unknown: "信息不足，暂缓删除",
};
export type Reading = { facts: string[]; answer: Assessment; source: string };
type Run = (operation: () => Promise<unknown>) => void;

function Model({
  item,
  report,
  samples,
  reading,
  save,
  close,
}: {
  item: ScanItem;
  report: ScanReport;
  samples: string[] | undefined;
  reading?: Reading;
  save: (v: Reading) => void;
  close: () => void;
}) {
  const stored = localStorage.getItem("model.provider");
  const [provider, setProvider] = useState<Provider>(
    stored && Object.hasOwn(services, stored) ? (stored as Provider) : "deepseek",
  );
  const defaultModel = (p: Provider) =>
    localStorage.getItem("model." + p) ?? (p === "deepseek" ? "deepseek-flash" : "");
  const [model, setModel] = useState(defaultModel(provider)),
    [key, setKey] = useState("");
  const [port, setPort] = useState(localStorage.getItem("model.port") ?? "8080");
  const [status, setStatus] = useNotice(),
    [pending, setPending] = useState(false);
  const prefix = item.path.endsWith("\\") ? item.path : item.path + "\\";
  const facts = samples && [
    tr("目录名 · {0}", basename(item.path)),
    tr(
      "扫描统计 · {0}，含 {1} 个文件，主要类型为{2}",
      bytes(item.bytes),
      count(item.files),
      label(item.kind),
    ),
    tr("最近文件修改 · {0}", date(item.modified)),
    tr("本地规则 · {0}。{1}", label(item.advice.label), label(item.advice.reason)),
    tr(
      "未检查其他副本、备份或程序使用情况。全次扫描跳过 {0} 项，读取错误 {1} 处。未读取文件正文。",
      report.totals.skipped,
      report.totals.errors,
    ),
    ...samples.map(sampleLabel),
    ...report.files
      .filter((f) => f.path.startsWith(prefix))
      .slice(0, 4)
      .map((f) => tr("较大文件 · {0}（{1}）", basename(f.path), bytes(f.bytes))),
  ];
  const host = provider === "local" ? "127.0.0.1:" + port : services[provider][0];
  return (
    <Dialog title={tr("模型解读用途")} close={close}>
      <p className="path">{item.path}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!facts || pending) return;
          setPending(true);
          setStatus(() => tr("正在等待 {0} 返回解读…", host));
          try {
            localStorage.setItem("model.provider", provider);
            localStorage.setItem("model." + provider, model.trim());
            if (provider === "local") localStorage.setItem("model.port", port);
            const answer = await ipc.explainDirectory(
              { provider, model: model.trim(), key, port: provider === "local" ? Number(port) : 0 },
              facts,
            );
            save({ answer, facts, source: host + " / " + model });
            setStatus(() => tr("解读完成"));
          } catch (err) {
            setStatus(() => nativeMessage(String(err)));
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={pending}>
          <div className="fields">
            <label>
              {tr("模型服务")}
              <select
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as Provider;
                  setProvider(p);
                  setModel(defaultModel(p));
                  setKey("");
                }}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="local">{tr("本机兼容服务")}</option>
              </select>
            </label>
            <label>
              {tr("模型名称")}
              <input
                required
                maxLength={256}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label>
              {tr("API 密钥")}
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  provider === "local" ? tr("可留空") : tr("默认使用 {0}", services[provider][1])
                }
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            {provider === "local" && (
              <label>
                {tr("本机端口")}
                <input
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
              </label>
            )}
          </div>
          <details>
            <summary>{tr("将发送至 {0} 的线索", host)}</summary>
            <ol>
              {facts?.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ol>
          </details>
          <button className="primary" disabled={!facts || pending}>
            <Sparkles />
            {tr("发送摘要并解读")}
          </button>
        </fieldset>
      </form>
      <p role="status">{status}</p>
      {reading && <Answer reading={reading} />}
    </Dialog>
  );
}
function Answer({ reading }: { reading: Reading }) {
  const { answer, facts, source } = reading;
  return (
    <div className="answer">
      <b>{label(verdicts[answer.verdict])}</b>
      <p>{answer.purpose}</p>
      <p>{answer.condition}</p>
      <details>
        <summary>{tr("判断依据")}</summary>
        <ul>
          {answer.evidence.map((i) => (
            <li key={i}>{facts[i - 1]}</li>
          ))}
        </ul>
      </details>
      <small>{source}</small>
    </div>
  );
}

export function Inspector({
  item,
  report,
  state,
  stage,
  keep,
  locate,
  locateCopy,
  enter,
  run,
  reading,
  save,
}: {
  item: ScanItem;
  report: ScanReport;
  state: string;
  stage?: () => void;
  keep: () => void;
  locate: () => void;
  locateCopy: (copy: ScanItem) => void;
  enter: () => void;
  run: Run;
  reading?: Reading;
  save: (value: Reading) => void;
}) {
  const sample = useData(JSON.stringify([report.generation, item.path]), () =>
    item.directory ? ipc.directorySample(item.path) : Promise.resolve([]),
  );
  const [target, setTarget] = useState<string | null>(null);
  const [copies, setCopies] = useState(false);
  return (
    <aside className="card inspector">
      <div className="panel-title">
        <h2>{tr("项目详情")}</h2>
        <span className="tag">{item.directory ? tr("目录") : tr("文件")}</span>
      </div>
      <div className="object-heading">
        <div className="object-icon">{item.directory ? <FolderOpen /> : <File />}</div>
        <h3 title={item.path}>{basename(item.path)}</h3>
      </div>
      <p className="path">{item.path}</p>
      <dl>
        {[
          [tr("逻辑大小"), bytes(item.bytes)],
          [
            tr("磁盘占用"),
            item.disk.unknown
              ? item.directory
                ? tr("{0}（部分）", bytes(item.disk.bytes))
                : tr("未知")
              : bytes(item.disk.bytes),
          ],
          ...(!item.directory && item.disk.charged < item.disk.bytes
            ? [[tr("硬链接"), tr("占用已归入其他路径")]]
            : []),
          [tr("主要类型"), label(item.kind)],
          [tr("文件数量"), count(item.files)],
          [tr("最近修改"), date(item.modified)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {stage && (
        <button
          id="stage"
          className="primary wide"
          disabled={item.path === report.root || !!state}
          title={item.path === report.root ? tr("请选择扫描起点下的文件或子目录") : undefined}
          onClick={stage}
        >
          <ListPlus />
          {label(state) || tr("加入待清理")}
        </button>
      )}
      <div className="evidence">
        <b>
          <ShieldCheck />
          {label(item.advice.label)}
        </b>
        <p>{label(item.advice.reason)}</p>
      </div>
      {item.directory && (
        <details className="samples">
          <summary>{tr("目录线索")}</summary>
          {sample?.error ??
            (sample?.value?.length ? (
              <ul>
                {sample.value.map((s, i) => (
                  <li key={i}>{sampleLabel(s)}</li>
                ))}
              </ul>
            ) : sample?.value ? (
              tr("空目录")
            ) : (
              tr("正在读取…")
            ))}
        </details>
      )}
      {reading && <Answer reading={reading} />}
      <div className="inspector-actions">
        {!item.directory && item.bytes > 0 && (
          <button onClick={() => setCopies(true)}>
            <LocateFixed />
            {tr("查找相同内容")}
          </button>
        )}
        {item.directory && (
          <button disabled={!sample?.value} onClick={() => setTarget(item.path)}>
            <Sparkles />
            {tr("模型解读用途")}
          </button>
        )}
        <button onClick={locate}>
          <LocateFixed />
          {tr("在目录中定位")}
        </button>
        {item.directory && (
          <button onClick={enter}>
            <ChevronRight />
            {tr("进入目录")}
          </button>
        )}
        <button
          onClick={() => run(() => ipc.openFolder(item.directory ? item.path : parent(item.path)))}
        >
          <ExternalLink />
          {tr("资源管理器")}
        </button>
        <button disabled={state === "待清理"} onClick={keep}>
          <Bookmark />
          {state === "已保留" ? tr("取消保留") : tr("本次保留")}
        </button>
      </div>
      {target === item.path && (
        <Model
          key={item.path}
          item={item}
          samples={sample?.value}
          report={report}
          reading={reading}
          save={save}
          close={() => setTarget(null)}
        />
      )}
      {copies && (
        <Copies
          item={item}
          generation={report.generation}
          locate={locateCopy}
          close={() => setCopies(false)}
        />
      )}
    </aside>
  );
}
