// Desktop devtools hotkey. WebView2 on Windows doesn't reliably bind F12 to the
// inspector inside a Tauri shell, so we bind it ourselves. The Rust `open_devtools`
// command exists only because the tauri crate is built with the `devtools` feature
// (see src-tauri). No-op on web.
import { isDesktop } from "./fileBridge";

export function initDevtoolsHotkey(): void {
  if (!isDesktop()) return;
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
