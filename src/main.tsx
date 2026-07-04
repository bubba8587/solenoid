import ReactDOM from "react-dom/client";
import App from "./App";
import { initAppTheme } from "./graph/appTheme";
import { initCableFlow } from "./graph/cableFlowStore";
import { initGridSnap } from "./graph/gridSnapStore";
import { initRenderMode, renderModeStore, gpuCapabilityStore } from "./graph/renderMode";
import { probeGpu } from "./graph/gpuProbe";
import { initSettings } from "./graph/settingsStore";
import { initPacks } from "./graph/packs";
import { initPackFcExtensions } from "./graph/fcExtensions";
import { initFrameBackend } from "./graph/frameBackend";
import { initDevtoolsHotkey } from "./graph/devtoolsHotkey";
import { pushNotice } from "./graph/noticeStore";
import { isDesktop } from "./graph/fileBridge";
import { IS_MOBILE } from "./graph/coarse";
import "@fontsource-variable/atkinson-hyperlegible-next";
// The italic FACE — without it, `*em*` / FC-italic render upright: the base
// import loads only the upright axis, and `font-synthesis: none` (App.css,
// deliberate to bar faux-bold) also bars synthetic italic. Loading the real
// italic file restores italics while keeping bold a true weight axis.
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-mono";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css";
import "./desktopFrame.css";

// Mark the desktop shell so the custom (decorum) title bar's CSS applies and the
// app reserves a strip for it. Browser build leaves this unset → no offset.
if (isDesktop()) document.documentElement.dataset.shell = "desktop";

// Mirror the mobile-mode flag onto the root so CSS can gate on it. This (not a
// `pointer: coarse` media query) is what all mobile styling keys off, so a
// phone's "Request desktop site" (desktop UA, still a coarse pointer) gets the
// desktop layout. Single source of truth: coarse.ts.
if (IS_MOBILE) document.documentElement.classList.add("is-mobile");

// Last-resort error surfacing (v1.0 audit, quality). The codebase leans on
// `void asyncFn()` fire-and-forget for graph mutations (group ops, Tauri invoke
// chains, keyboard-driven processGraph); a rejection there previously vanished —
// and on the desktop build the console is closed, so the sole bug reporter saw
// "the button did nothing". Throttled so a rejection storm (one per node in a
// broken pass) doesn't stack a wall of toasts.
{
  let lastNotice = 0;
  // "ResizeObserver loop completed with undelivered notifications" / "loop limit
  // exceeded" is a BENIGN browser notice, not an error — a ResizeObserver
  // callback changed layout in a way that needs another pass (our node cards,
  // overlays and formula-fit all observe their own size). Browsers fire it at
  // window.onerror with no `error` object; surfacing it as a scary "something
  // went wrong" toast on every mobile load is pure noise. Suppress it. (This is
  // the standard, documented handling — the message is a signal to re-observe,
  // not a fault.)
  const isBenign = (detail: unknown): boolean => {
    const msg = detail instanceof Error ? detail.message : String(detail ?? "");
    return msg.includes("ResizeObserver loop");
  };
  const surface = (kind: string, detail: unknown) => {
    if (isBenign(detail)) return;
    console.error(`[solenoid] ${kind}:`, detail);
    const now = Date.now();
    if (now - lastNotice < 5000) return;
    lastNotice = now;
    const msg = detail instanceof Error ? detail.message : String(detail ?? "unknown error");
    pushNotice(`Something went wrong internally (${msg.slice(0, 160)}). If the app misbehaves, save and reload.`, "error");
  };
  window.addEventListener("unhandledrejection", (e) => surface("unhandled rejection", e.reason));
  window.addEventListener("error", (e) => surface("uncaught error", e.error ?? e.message));
}

initAppTheme();
initCableFlow();
initGridSnap();
initRenderMode();
initSettings();

// GPU capability probe (renderer-plan safety rule): the canvas renderer is only
// an option on a real, hardware-backed GPU context. If the probe finds none (or
// only a software rasterizer), force render mode back to DOM — a software canvas
// is slower than DOM, so it must never be chosen. Async + best-effort; DOM is the
// safe default while it resolves.
void probeGpu().then((cap) => {
  gpuCapabilityStore.set(cap);
  if (!cap.canUseCanvas && renderModeStore.get() === "canvas") {
    renderModeStore.set("dom");
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[solenoid] GPU probe: tier=${cap.tier} software=${cap.software} renderer=${cap.renderer ?? "?"}`);
  }
});
initPacks();
initPackFcExtensions(); // register pack-contributed FC units/formats for resolution

// Select the native Polars frame backend on desktop (no-op on web — keeps the
// in-process JS backend). Best-effort; the seam is inert until frame nodes migrate.
void initFrameBackend();

// F12 / Ctrl+Shift+I → open the webview devtools (desktop only).
initDevtoolsHotkey();

if (import.meta.env.DEV) {
  import("./graph/catalogValidator").then(m => m.validateCatalog());
  import("./graph/devRebuildSeeds"); // TEMP: exposes window.__rebuildSeeds()
  import("./graph/devHarness"); // DEV: window.__spike for the DOM-vs-Pixi screenshot harness
}

// NOTE: intentionally NOT wrapped in <React.StrictMode>. rete-react-plugin
// manages the graph editor imperatively (its own DOM + React roots created in
// Canvas's init effect). StrictMode's dev-only mount→unmount→remount double-
// invokes that effect, and the async init races teardown — leaving two live
// elements registered for each socket, which spams the console with
// "Found more than one element for socket with same key and side". The graph
// nodes render in rete's own root, so StrictMode wasn't checking them anyway.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
