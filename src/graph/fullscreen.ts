import { isDesktop } from "./fileBridge";

/** iOS Safari exposes no Fullscreen API for arbitrary elements, so callers must hide
 *  the affordance rather than offer a dead button. */
export function fullscreenSupported(): boolean {
  if (isDesktop()) return true;
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
}

export function toggleFullscreen(): void {
  if (isDesktop()) {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("toggle_fullscreen"))
      .catch(() => { /* command unavailable — ignore */ });
    return;
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen?.().catch(() => {});
  } else {
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

/** Tauri only — binding F11 on web desktop would preventDefault Chrome's native F11. */
export function initFullscreenHotkey(): void {
  if (!isDesktop()) return;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F11") return;
    e.preventDefault();
    toggleFullscreen();
  });
}
