import ReactDOM from "react-dom/client";
import App from "./App";
import { initAppTheme } from "./graph/appTheme";
import { initCableFlow } from "./graph/cableFlowStore";
import { initGridSnap } from "./graph/gridSnapStore";
import { initCableShape } from "./graph/cableShape";
import { initRenderMode, renderModeStore, gpuCapabilityStore } from "./graph/renderMode";
import { probeGpu } from "./graph/gpuProbe";
import { initSettings } from "./graph/settingsStore";
import { initPacks } from "./graph/packs";
import { initPackFcExtensions } from "./graph/fcExtensions";
import { initPackFormulas } from "./graph/formulaExtensions";
import { initFrameBackend } from "./graph/frameBackend";
import { shouldReloadForChunkError, type ReloadStore } from "./graph/chunkReloadGuard";
import { initDevtoolsHotkey } from "./graph/devtoolsHotkey";
import { initFullscreenHotkey } from "./graph/fullscreen";
import { pushNotice } from "./graph/noticeStore";
import { isDesktop } from "./graph/fileBridge";
import { IS_MOBILE, IS_TABLET } from "./graph/coarse";
import { ErrorBoundary } from "./graph/components/ErrorBoundary";
import "./graph/components/errorBoundary.css";
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
// A tablet runs the desktop chrome, so it gets no bottom action bar — the top bar
// grows the touch actions instead (TabletActions). Mutually exclusive with is-mobile.
if (IS_TABLET) document.documentElement.classList.add("is-tablet");

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

  // A dynamically-imported chunk failed to LOAD (not a runtime error inside it) —
  // almost always because a NEW deploy replaced the hashed chunk files while this
  // tab was open, so the old hash 404s the instant a lazy import fires (Tidy's ELK,
  // Mermaid, charts, KaTeX — anything code-split). Vite raises `vite:preloadError`
  // for exactly this. Reload ONCE to pull the fresh index.html + valid chunk refs;
  // guarded via sessionStorage so a genuine network outage can't loop (one reload
  // per 10s window, else let it surface as a normal error instead).
  window.addEventListener("vite:preloadError", (e) => {
    const KEY = "sol:chunkReloadAt";
    const store: ReloadStore = {
      get: () => sessionStorage.getItem(KEY),
      set: (v) => sessionStorage.setItem(KEY, v),
    };
    // Fail-safe: reloads only when the guard can be persisted, so a genuine outage
    // in private browsing (sessionStorage throws) surfaces as an error instead of
    // looping forever.
    if (!shouldReloadForChunkError(Date.now(), store)) return;
    e.preventDefault(); // we're recovering via reload; don't also throw to the console
    window.location.reload();
  });
}

initAppTheme();
initCableFlow();
initGridSnap();
initCableShape();
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
initPackFormulas();     // ...and pack-contributed formula functions (advertised only while active)

// Select the native Polars frame backend on desktop (no-op on web — keeps the
// in-process JS backend). Best-effort; the seam is inert until frame nodes migrate.
void initFrameBackend();

// F12 / Ctrl+Shift+I → open the webview devtools (desktop only).
initDevtoolsHotkey();

// F11 → toggle fullscreen (Tauri desktop only; web desktop uses Chrome's native F11).
initFullscreenHotkey();

if (import.meta.env.DEV) {
  import("./graph/catalogValidator").then(m => m.validateCatalog());
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
  // Without this the app had no boundary at all: any render throw blanked the
  // screen and took its own diagnosis with it. Now it names what threw.
  <ErrorBoundary scope="app">
    <App />
  </ErrorBoundary>,
);
