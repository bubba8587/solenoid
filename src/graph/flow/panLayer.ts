// [[C120]] linearWork. The pan layer (react-flow-surface-contract § Drag performance).
import { renderModeStore } from "../renderMode";

const CLASS = "sol-pan-layer";

/** Chromium engines only: the layer's raster and merge behavior is measured there, WebKit (WebKitGTK, Safari) rasters a layer
 *  at 1× and stretches it, and the HTML-in-Canvas mode promotes the viewport itself. */
export function promotesPans(chromium = typeof navigator !== "undefined" && "userAgentData" in navigator, mode = renderModeStore.get()): boolean {
  return chromium && mode !== "html";
}

/** A pointer drag that moves the camera: wheel and pinch zoom and programmatic moves carry no press. */
export function isPressPan(event: { type: string } | null | undefined): boolean {
  return !!event && /^(mousedown|pointerdown|touchstart)$/.test(event.type);
}

/** The camera moved onto whole device pixels. A promoted layer composites at a fractional offset with smoothing, so text panned
 *  soft; a press snaps the camera before the drag starts (at most half a pixel), and pointer deltas, whole device pixels, keep it whole. */
export function alignedViewport<V extends { x: number; y: number }>(v: V, dpr: number): V | null {
  const x = Math.round(v.x * dpr) / dpr;
  const y = Math.round(v.y * dpr) / dpr;
  return x === v.x && y === v.y ? null : { ...v, x, y };
}

type Cam = { x: number; y: number; zoom: number };

/** The layer goes up at rest once the camera settles (`prime`), or failing that on the first camera move of a press pan, and stays through the strokes that follow: a release keeps it,
 *  since dropping and raising it re-records every card on screen, a hitch per finger flick. It drops when the zoom changes (a
 *  layer zooms on a stale raster), and when a move it didn't drive leaves the camera off whole pixels, where it composites soft. */
export function createPanLayer(
  viewportOf: () => HTMLElement | null | undefined,
  gate: () => boolean = () => promotesPans(),
  dpr: () => number = () => (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
) {
  let el: HTMLElement | null = null;
  let hold: { cancel(): void } | null = null;
  let armed = false;
  let pressing = false;
  let zoom = 0;
  const drop = () => {
    armed = false;
    hold?.cancel();
    hold = null;
    el?.classList.remove(CLASS);
    el = null;
  };
  const raise = () => {
    el = viewportOf() ?? null;
    if (!el) return;
    el.classList.add(CLASS);
    if (!(globalThis as { __noPanHold?: boolean }).__noPanHold) hold = el.animate?.([{ translate: "0 0 1px" }, { translate: "0 0 1px" }], { duration: 3.6e6, iterations: Infinity }) ?? null;
  };
  const press = (k: number) => {
    pressing = true;
    if (el && k === zoom) return;
    drop();
    armed = gate();
    zoom = k;
  };
  return {
    /** A press on the pane. A programmatic move (the press-time snap, a fit) is not a press and never starts or ends one. */
    start(event: { type: string } | null | undefined, k: number) {
      if (isPressPan(event)) press(k);
    },
    /** A pan the app drives itself (a finger pan that starts on a card), which React Flow sees only as programmatic moves. */
    begin(k: number) {
      press(k);
    },
    move(cam: Cam) {
      if (el && cam.zoom !== zoom) { drop(); return; }
      if (el && !pressing && alignedViewport(cam, dpr())) { drop(); return; }
      if (!armed || !pressing || cam.zoom !== zoom) return;
      armed = false;
      raise();
    },
    /** Raise the layer at rest, so the one full re-record that raising costs lands while nothing moves instead of on a pan's
     *  first frame. The caller has put the camera on whole pixels first. */
    prime(k: number) {
      if (el || pressing || !gate()) return;
      zoom = k;
      raise();
    },
    /** The press ended; the layer stays for the next stroke. A programmatic end (null) is not a release. */
    release(event?: { type: string } | null) {
      if (event === null) return;
      pressing = false;
      armed = false;
    },
    drop,
  };
}
