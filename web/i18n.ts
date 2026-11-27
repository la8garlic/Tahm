import { useState, useSyncExternalStore } from "react";
import en from "./en.json";

type Language = "en" | "zh-CN";
export type MessageKey = keyof typeof en;
const preference = "tahm.language";
const saved = localStorage.getItem(preference);
let language: Language =
  saved === "en" || saved === "zh-CN"
    ? saved
    : new Intl.Locale(navigator.language).language === "en"
      ? "en"
      : "zh-CN";
const listeners = new Set<() => void>();
export const locale = () => language;
export function setLanguage(next: Language) {
  localStorage.setItem(preference, next);
  language = next;
  listeners.forEach((notify) => notify());
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
export const useLanguage = () => useSyncExternalStore(subscribe, locale);

export function tr(key: MessageKey, ...values: (string | number)[]) {
  const text = language === "en" ? en[key] : key;
  return values.length ? text.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)])) : text;
}

// 仅用于扫描器定义的分类和提示；路径、卷名和文件名保持原样。
export function label(text: string) {
  return language === "en" && Object.hasOwn(en, text) ? en[text as MessageKey] : text;
}

// Rust 返回的错误可带路径或系统错误。只匹配完整的已知格式，参数按原样显示。
const nativeFormats: MessageKey[] = [
  "目录已变化，请重新扫描：{0}",
  "大小从 {0} 变为 {1} 字节",
  "文件属性从 {0} 变为 {1}",
  "{0}：{1}。请重新扫描并复核。",
  "无法复核 {0}：{1}",
  "扫描后新增了条目：{0}",
  "扫描后条目已移出或改名：{0}",
  "Windows 回收失败：{0}",
  "请填写 API 密钥，或先设置环境变量 {0} 再启动塔姆。",
  "模型服务返回 HTTP {0} {1}，请核对模型、凭据及服务额度。",
  "模型调用失败：{0}",
  "模型返回的解读格式无效：{0}",
  "磁盘占用未计入：{0} — {1}",
  "路径经过重解析点，请选择实际目录：{0}",
];
const patterns = nativeFormats.map((key) => ({
  key,
  pattern: new RegExp(
    "^" +
      key
        .split(/\{\d+\}/)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("([\\s\\S]+)") +
      "$",
  ),
}));
export function nativeMessage(text: string): string {
  if (language !== "en") return text;
  if (text.startsWith("Error: ")) return "Error: " + nativeMessage(text.slice(7));
  for (const { key, pattern } of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const args = match.slice(1);
      if (key === "{0}：{1}。请重新扫描并复核。") args[1] = nativeMessage(args[1]!);
      return tr(key, ...args);
    }
  }
  return label(text);
}
export function sampleLabel(text: string) {
  const split = text.indexOf(" · ");
  if (text.startsWith("文件 · ")) return tr("文件 · {0}", text.slice(split + 3));
  if (text.startsWith("子目录 · ")) return tr("子目录 · {0}", text.slice(split + 3));
  return split < 0 ? text : label(text.slice(0, split)) + text.slice(split);
}

// 状态可能跨越语言切换；保留数值与路径，到显示时再生成文案。
export function useNotice(initial: () => string = () => "") {
  const [render, setRender] = useState<() => string>(() => initial);
  return [render(), (next: () => string) => setRender(() => next)] as const;
}
