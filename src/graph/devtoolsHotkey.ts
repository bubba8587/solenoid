// WebView2 doesn't reliably bind F12 inside a Tauri shell, so we bind it here; the
// Rust `open_devtools` command needs the tauri crate's `devtools` feature.
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
