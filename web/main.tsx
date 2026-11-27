import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TitleBar, windowTitle } from "./TitleBar";
import { useLayoutEffect } from "react";
import { useLanguage } from "./i18n";
import "./style.css";
// 保留应用自己的右键操作，取消 WebView2 的浏览器菜单（含键盘触发）。
document.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });
function Desktop() {
  const language = useLanguage();
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    document.title = windowTitle();
    void window.__TAURI__.window.getCurrentWindow().setTitle(document.title);
  }, [language]);
  return (
    <>
      <TitleBar />
      <App />
    </>
  );
}
createRoot(document.getElementById("app")!).render(<Desktop />);
