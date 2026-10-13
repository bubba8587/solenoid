// [[C120]] linearWork. The pan layer (react-flow-surface-contract § Drag performance).
import { IS_COARSE } from "../coarse";
import { renderModeStore } from "../renderMode";

const CLASS = "sol-pan-layer";

/** Chromium engines on fine pointers only: the layer's raster and merge behavior is measured there, WebKit (WebKitGTK, Safari)
 *  rasters a layer at 1× and stretches it, a coarse pointer may be a mobile GPU, and the HTML-in-Canvas mode promotes the viewport itself. */
export function promotesPans(coarse = IS_COARSE, chromium = typeof navigator !== "undefined" && "userAgentData" in navigator, mode = renderModeStore.get()): boolean {
  return !coarse && chromium && mode !== "html";
}

/** A pointer drag that moves the camera: wheel and pinch zoom and programmatic moves carry no press. */
export function isPressPan(event: { type: string } | null | undefined): boolean {
  return !!event && /^(mousedown|pointerdown|touchstart)$/.test(event.type);
}

/** One promote on the first camera move of a press pan and one demote at its end (a click on the pane moves nothing and never promotes); a zoom mid-gesture demotes for the rest of it, since a promoted layer zooms on a stale raster. */
export function createPanLayer(viewportOf: () => HTMLElement | null | undefined, gate: () => boolean = () => promotesPans()) {
  let el: HTMLElement | null = null;
  let armed = false;
  let zoom = 0;
  const end = () => {
    armed = false;
    el?.classList.remove(CLASS);
    el = null;
  };
  return {
    /** Only a press starts or ends the gesture: a programmatic move inside a pan (the press-time snap) must not end it. */
    start(event: { type: string } | null | undefined, k: number) {
      if (!isPressPan(event)) return;
      end();
      armed = gate();
      zoom = k;
    },
    move(k: number) {
      if (!armed && !el) return;
      if (k !== zoom) { end(); return; }
      if (!armed) return;
      armed = false;
      el = viewportOf() ?? null;
      el?.classList.add(CLASS);
    },
    end(event?: { type: string } | null) {
      if (event !== null) end();
    },
  };
}

/** The camera moved onto whole device pixels. A promoted layer composites at a fractional offset with smoothing, so text panned
 *  soft; a press snaps the camera before the drag starts (at most half a pixel), and a mouse's deltas keep it whole. */
export function alignedViewport<V extends { x: number; y: number }>(v: V, dpr: number): V | null {
  const x = Math.round(v.x * dpr) / dpr;
  const y = Math.round(v.y * dpr) / dpr;
  return x === v.x && y === v.y ? null : { ...v, x, y };
}
