// Fullscreen toggle — shared by the F11 hotkey (desktop) and the touch pill button
// (phones' mobile UI and tablets' desktop UI alike — gated on IS_COARSE in NavMenu).
//
// Two backends:
//  - Tauri desktop: the WebView2 shell has no browser chrome, so F11 does nothing on
//    its own. We bind F11 ourselves and invoke the Rust `toggle_fullscreen` command,
//    which flips the native window's fullscreen state.
//  - Web (the mobile pill button, and any browser without native F11): the standard
//    Fullscreen API on the document element. Desktop web already gets Chrome's own
//    F11, so we deliberately DON'T bind F11 there (binding + preventDefault would
//    break the native behavior).
import { isDesktop } from "./fileBridge";

/** True when a fullscreen affordance can work here — always on Tauri, else only if
 *  the browser exposes the Fullscreen API (iOS Safari doesn't for arbitrary
 *  elements, so the mobile button hides itself there rather than being a dead key). */
export function fullscreenSupported(): boolean {
  if (isDesktop()) return true;
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen;
}

/** Toggle fullscreen via whichever backend applies. */
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

/** Bind F11 → toggle, Tauri desktop only. Web desktop keeps Chrome's native F11. */
export function initFullscreenHotkey(): void {
  if (!isDesktop()) return;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F11") return;
    e.preventDefault();
    toggleFullscreen();
  });
}
