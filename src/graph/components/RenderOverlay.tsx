import { useEffect, useRef, useSyncExternalStore } from "react";
import { overlayBus, deviceMatrix, type AreaTransform } from "../overlayTransform";
import { useRenderMode } from "../renderMode";
import { createToggleStore } from "../storeKit";

// Phase 0 — the transparent canvas overlay that mirrors rete's pan/zoom EXACTLY.
// It draws nothing real yet: its only job is to prove the area-transform → canvas
// device-pixel mapping (overlayTransform.ts) before any geometry moves onto it.
//
// The <canvas> is pinned over the rete container (pointer-events:none, so it never
// steals interaction) and its backing store is sized to devicePixelRatio. We bake
// the area transform into a single ctx.setTransform so geometry is authored in
// WORLD units — the same units node positions use — and lands pixel-aligned with
// the DOM nodes at every zoom level.
//
// VERIFICATION MODE (off by default → no visual change ships): toggle
// `overlayDebugStore` (e.g. from the console: `window.__solenoidOverlayDebug?.()`)
// to draw a world-anchored grid + origin axes + a marker at world (0,0). Pan/zoom
// and confirm the grid tracks the DOM nodes lockstep. When off, the canvas stays
// fully transparent.

/** Debug toggle for the Phase-0 verification grid. Off by default. */
export const overlayDebugStore = createToggleStore(false);

// Expose a console hook so the author can flip the verification grid on the build
// without any UI. Idempotent; guarded for SSR / non-browser test envs.
if (typeof window !== "undefined") {
  (window as unknown as { __solenoidOverlayDebug?: () => void }).__solenoidOverlayDebug =
    () => overlayDebugStore.toggle();
}

/** World-space spacing of the verification grid lines, in world units. Matches a
 *  comfortable on-screen density at k≈1. Purely a debug aid. */
const DEBUG_GRID_WORLD = 120;

function drawDebug(ctx: CanvasRenderingContext2D, t: AreaTransform, dpr: number, cssW: number, cssH: number) {
  // Work out the world-space rectangle currently visible, so we only stroke the
  // grid lines on screen (not the whole infinite plane).
  if (t.k === 0) return;
  const wLeft = (0 - t.x) / t.k;
  const wTop = (0 - t.y) / t.k;
  const wRight = (cssW - t.x) / t.k;
  const wBottom = (cssH - t.y) / t.k;

  ctx.save();
  // Author in WORLD units: one matrix carries pan, zoom, and dpr.
  ctx.setTransform(...deviceMatrix(t, dpr));
  // Keep stroke ~1 CSS px regardless of zoom (lineWidth is in world units here).
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

  // Origin axes + a solid marker at world (0,0) — the anchor the eye checks.
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
  // Re-read overlay state on every notify (transform / viewport change).
  const state = useSyncExternalStore(overlayBus.subscribe, overlayBus.get);

  // Feed the container size + dpr to the bus via a ResizeObserver on the canvas's
  // parent (the canvas wrapper). Also catches devicePixelRatio changes on a
  // cross-monitor move via a matchMedia listener — re-armed each flip, since the
  // `(resolution: Ndppx)` query is bound to the dpr at registration and goes stale
  // after one change. setViewport's notify drives the redraw (no manual force).
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

  // Redraw whenever the transform, viewport, mode, or debug flag changes.
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

    // Phase 0: only the verification grid draws, and only when debug is on AND the
    // canvas path is selectable (mode flips it on later phases). Until then the
    // overlay is a transparent, inert layer — zero visual change.
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
        // Above the grid background, below interactive node chrome / menus. The
        // cable layer it will eventually replace lives in this band too.
        zIndex: 1,
      }}
    />
  );
}
