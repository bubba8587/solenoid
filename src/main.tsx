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
import { IS_MOBILE, IS_TABLET } from "./graph/coarse";
import { ErrorBoundary } from "./graph/components/ErrorBoundary";
import "./graph/components/errorBoundary.css";
import "@fontsource-variable/atkinson-hyperlegible-next/index.css";
// The italic FACE: the base import is upright-only and `font-synthesis: none`
// (App.css) bars the synthetic fallback, so without this `*em*` renders upright.
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/index.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css";
import "./desktopFrame.css";

// Marks the shell so the custom title bar's CSS applies and reserves its strip.
if (isDesktop()) document.documentElement.dataset.shell = "desktop";

// All mobile styling keys off THIS flag, never a `pointer: coarse` query — that is
// what lets a phone's "Request desktop site" get the desktop layout.
if (IS_MOBILE) document.documentElement.classList.add("is-mobile");
// A tablet runs desktop chrome with touch actions in the top bar; mutually
// exclusive with is-mobile.
if (IS_TABLET) document.documentElement.classList.add("is-tablet");

// Last-resort surfacing for the codebase's `void asyncFn()` fire-and-forget, since
// the desktop console is closed. Throttled so a rejection storm can't stack toasts.
{
  let lastNotice = 0;
  // The ResizeObserver loop notice is BENIGN (a callback changed layout, needing
  // another pass) but arrives at window.onerror — suppress it, don't toast it.
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

  // A code-split chunk 404s when a new deploy replaces the hashed files under an open
  // tab; reload ONCE for fresh refs, guarded so a network outage can't loop.
  window.addEventListener("vite:preloadError", (e) => {
    const KEY = "sol:chunkReloadAt";
    const store: ReloadStore = {
      get: () => sessionStorage.getItem(KEY),
      set: (v) => sessionStorage.setItem(KEY, v),
    };
    // Reload only when the guard persists — private mode throws, and an unguarded
    // reload there would loop forever.
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

// Intentionally NOT wrapped in <React.StrictMode>: its double-invoked mount races
// rete's async editor init, leaving two live elements per socket.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary scope="app">
    <App />
  </ErrorBoundary>,
);
