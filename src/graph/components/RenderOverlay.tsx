import { useEffect, useRef, useSyncExternalStore } from "react";
import { overlayBus, deviceMatrix, type AreaTransform } from "../overlayTransform";
import { useRenderMode } from "../renderMode";
import { createToggleStore } from "../storeKit";

// A canvas pinned over the rete container; the area transform is baked into ONE
// ctx.setTransform so geometry is authored in WORLD units and stays DOM-aligned at any zoom.
// `window.__solenoidOverlayDebug?.()` draws a verification grid; off, the canvas is empty.

/** Debug toggle for the verification grid. Off by default. */
export const overlayDebugStore = createToggleStore(false);

// Console hook to flip the grid on a build with no UI; idempotent, SSR-guarded.
if (typeof window !== "undefined") {
  (window as unknown as { __solenoidOverlayDebug?: () => void }).__solenoidOverlayDebug =
    () => overlayDebugStore.toggle();
}

/** Grid spacing in world units — a comfortable on-screen density at k≈1. */
const DEBUG_GRID_WORLD = 120;

function drawDebug(ctx: CanvasRenderingContext2D, t: AreaTransform, dpr: number, cssW: number, cssH: number) {
  // Stroke only the visible world rect, not the whole infinite plane.
  if (t.k === 0) return;
  const wLeft = (0 - t.x) / t.k;
  const wTop = (0 - t.y) / t.k;
  const wRight = (cssW - t.x) / t.k;
  const wBottom = (cssH - t.y) / t.k;

  ctx.save();
  // Author in WORLD units: one matrix carries pan, zoom, and dpr.
  ctx.setTransform(...deviceMatrix(t, dpr));
  // lineWidth is in WORLD units here, so divide to keep the stroke ~1 CSS px.
  ctx.lineWidth = 1 / t.k;

  ctx.strokeStyle = "rgba(120, 170, 255, 0.35)";
  ctx.beginPath();
  const startX = Math.floor(wLeft / DEBUG_GRID_WORLD) * DEBUG_GRID_WORLD;
  for (let x = startX; x <= wRight; x += DEBUG_GRID_WORLD) {
    ctx.moveTo(x, wTop);
    ctx.lineTo(x, wBottom);
  }
  const startY = Math.floor(wTop / DEBUG_GRID_WORLD) * DEBUG_GRID_WORLD;
  for (let y = startY; y <= wBottom; y += DEBUG_GRID_WORLD) {
    ctx.moveTo(wLeft, y);
    ctx.lineTo(wRight, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 80, 80, 0.7)";
  ctx.lineWidth = 2 / t.k;
  ctx.beginPath();
  ctx.moveTo(wLeft, 0); ctx.lineTo(wRight, 0);
  ctx.moveTo(0, wTop); ctx.lineTo(0, wBottom);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 80, 80, 0.9)";
  ctx.beginPath();
  ctx.arc(0, 0, 6 / t.k, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function RenderOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mode = useRenderMode();
  const debug = useSyncExternalStore(overlayDebugStore.subscribe, overlayDebugStore.get);
  const state = useSyncExternalStore(overlayBus.subscribe, overlayBus.get);

  // The dpr matchMedia listener must be RE-ARMED on each flip — an `(resolution: Ndppx)`
  // query binds to the dpr at registration and goes stale after one change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;
    const sync = () => {
      const r = parent.getBoundingClientRect();
      overlayBus.setViewport(r.width, r.height, window.devicePixelRatio || 1);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(parent);

    let mq: MediaQueryList | null = null;
    const onDpr = () => { sync(); armDprWatch(); };
    function armDprWatch() {
      mq?.removeEventListener?.("change", onDpr);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener?.("change", onDpr);
    }
    armDprWatch();
    return () => { ro.disconnect(); mq?.removeEventListener?.("change", onDpr); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { viewport, dpr, transform } = state;
    const wPx = Math.max(1, Math.round(viewport.width * dpr));
    const hPx = Math.max(1, Math.round(viewport.height * dpr));
    if (canvas.width !== wPx) canvas.width = wPx;
    if (canvas.height !== hPx) canvas.height = hPx;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (debug) drawDebug(ctx, transform, dpr, viewport.width, viewport.height);
  }, [state, mode, debug]);

  return (
    <canvas
      ref={canvasRef}
      className="solenoid-render-overlay"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        // Above the grid background, below interactive node chrome / menus.
        zIndex: 1,
      }}
    />
  );
}
