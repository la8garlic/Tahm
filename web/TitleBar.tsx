import { useEffect, useState } from "react";
import { Copy, Languages, Minus, Square, X } from "lucide-react";
import { locale, setLanguage } from "./i18n";
import { version } from "../package.json";

export const windowTitle = () =>
  locale() === "en" ? "Tahm · Disk Space Analyzer" : "塔姆 · 磁盘空间分析";
const desktop = window.__TAURI__.window.getCurrentWindow();

export function TitleBar() {
  const english = locale() === "en";
  const [brand, description] = windowTitle().split(" · ");
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    // 拖到屏幕边缘、系统快捷键和双击标题栏也会改变窗口状态。
    let request = 0;
    async function sync() {
      const current = ++request;
      const state = await desktop.isMaximized();
      if (current === request) setMaximized(state);
    }
    void sync();
    window.addEventListener("resize", sync);
    return () => {
      request++;
      window.removeEventListener("resize", sync);
    };
  }, []);

  const minimize = english ? "Minimize" : "最小化";
  const toggle = maximized ? (english ? "Restore" : "还原") : english ? "Maximize" : "最大化";
  const close = english ? "Close window" : "关闭窗口";
  return (
    <header className="window-bar" aria-label={windowTitle()}>
      <div className="window-caption" data-tauri-drag-region="deep">
        <img src="./tahm.svg" alt="" draggable={false} width={25} height={25} />
        <b>{brand}</b>
        <span>{description}</span>
        <small className="app-version">v{version}</small>
      </div>
      <button
        className="language-switch"
        type="button"
        lang={english ? "zh-CN" : "en"}
        aria-label={english ? "切换到中文" : "Switch to English"}
        title={english ? "切换到中文" : "Switch to English"}
        onClick={() => setLanguage(english ? "zh-CN" : "en")}
      >
        <Languages />
        {english ? "中文" : "English"}
      </button>
      <button
        type="button"
        title={minimize}
        aria-label={minimize}
        onClick={() => desktop.minimize()}
      >
        <Minus />
      </button>
      <button
        type="button"
        title={toggle}
        aria-label={toggle}
        onClick={() => desktop.toggleMaximize()}
      >
        {maximized ? <Copy /> : <Square />}
      </button>
      <button
        type="button"
        className="window-close"
        title={close}
        aria-label={close}
        onClick={() => desktop.close()}
      >
        <X />
      </button>
    </header>
  );
}
