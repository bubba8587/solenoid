// [[C93]] gestureByPointerType (IS_MOBILE is the one mobile gate), [[C99]] chromeEnvelopeVars
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAppTheme } from "./graph/appTheme";
import { initCableFlow } from "./graph/cableFlowStore";
import { initGridSnap } from "./graph/gridSnapStore";
import { initCableShape } from "./graph/cableShape";
import { initRenderMode } from "./graph/renderMode";
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
import { OWN_WINDOW_CONTROLS } from "./graph/WindowControls";
import { IS_MOBILE, IS_TABLET } from "./graph/coarse";
import { ErrorBoundary } from "./graph/components/ErrorBoundary";
import "./graph/components/errorBoundary.css";
import "@fontsource-variable/atkinson-hyperlegible-next/index.css";
// The italic face: `font-synthesis: none` (App.css) bars a synthetic italic, so without this `*em*` renders upright.
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/index.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css";
import "./desktopFrame.css";

if (isDesktop()) document.documentElement.dataset.shell = "desktop";
// linux shim for crisp canvas zoom (tree/specs/canvas/layout-chrome.md)
if (OWN_WINDOW_CONTROLS) document.documentElement.dataset.webview = "webkitgtk";

// Mobile styling keys off this flag, never `pointer: coarse`, so a phone's "Request desktop site" gets the desktop layout.
if (IS_MOBILE) document.documentElement.classList.add("is-mobile");
// Mutually exclusive with is-mobile.
if (IS_TABLET) document.documentElement.classList.add("is-tablet");

// Last-resort surfacing for `void asyncFn()` failures, since the desktop console is closed; throttled against storms.
{
  let lastNotice = 0;
  // The ResizeObserver loop notice is benign but arrives at window.onerror.
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

  // A new deploy 404s the hashed chunks under an open tab: reload once, guarded so an outage can't loop.
  window.addEventListener("vite:preloadError", (e) => {
    const KEY = "sol:chunkReloadAt";
    const store: ReloadStore = {
      get: () => sessionStorage.getItem(KEY),
      set: (v) => sessionStorage.setItem(KEY, v),
    };
    // Reload only when the guard persists: private mode throws, and an unguarded reload there would loop forever.
    if (!shouldReloadForChunkError(Date.now(), store)) return;
    e.preventDefault();
    window.location.reload();
  });
}

initAppTheme();
initCableFlow();
initGridSnap();
initCableShape();
initRenderMode();
initSettings();

initPacks();
initPackFcExtensions();
initPackFormulas();

void initFrameBackend();

initDevtoolsHotkey();

initFullscreenHotkey();

if (import.meta.env.DEV) {
  import("./graph/catalogValidator").then(m => m.validateCatalog());
  import("./graph/devHarness");
}

// Not wrapped in <React.StrictMode>: its double-invoked mount races rete's async editor init, leaving two elements per socket.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary scope="app">
    <App />
  </ErrorBoundary>,
);

if (import.meta.env.DEV) {
  void import("./graph/seedTune");
  void import("./graph/census");
  void import("./devCopyEdit");
}
