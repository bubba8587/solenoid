// WebView2 doesn't reliably bind F12 in a Tauri shell, so it is bound here; `open_devtools` needs the tauri crate's
// `devtools` feature.
import { isDesktop, isAndroidApp } from "./fileBridge";

/** Android's webview is inspected from a computer's chrome://inspect instead. */
export function initDevtoolsHotkey(): void {
  if (!isDesktop() || isAndroidApp()) return;
  window.addEventListener("keydown", (e) => {
    const isF12 = e.key === "F12";
    const isInspect = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "i");
    if (!isF12 && !isInspect) return;
    e.preventDefault();
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("open_devtools"))
      .catch(() => { /* devtools unavailable (e.g. feature off) — ignore */ });
  });
}
