import { useEffect, useState, useSyncExternalStore } from "react";
import { getArea, getEditor } from "./process";
import { collapsedAwareNodesRect } from "./components/Minimap";
import { canvasLockStore } from "./canvasLock";
import { cableFlourishBridge } from "./cableFlourishStore";
import { IS_MOBILE } from "./coarse";
import { fullscreenSupported, toggleFullscreen } from "./fullscreen";
import "./NavMenu.css";

const ZOOM_STEP = 1.08;

async function zoomBy(delta: number) {
  const area = getArea();
  if (!area) return;
  const { k, x, y } = area.area.transform;
  const next = Math.max(0.1, Math.min(4, k * delta));
  if (next === k) return;
  // Keep the viewport CENTER fixed during the zoom. rete's zoom API
  // accepts an (ox, oy) that gets ADDED to the transform after the
  // scale change. Solving for "screen point (cx, cy) stays put":
  //   newX = cx − (next / k) * (cx − x)   →   dx = (cx − x) * (1 − next/k)
  const rect = area.container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const ratio = 1 - next / k;
  await area.area.zoom(next, (cx - x) * ratio, (cy - y) * ratio);
}

// The chrome panels overlay the canvas, so a plain zoom-to-fit centers content
// under the header / behind the side panels. Measure the live chrome rects and
// fit into the free rectangle between them instead.
function visibleInsets(c: DOMRect) {
  const q = (s: string) => document.querySelector(s) as HTMLElement | null;
  const rect = (el: HTMLElement | null) => el?.getBoundingClientRect() ?? null;
  const M = 14; // breathing margin off each panel
  // Mobile chrome is just two full-width edges — the top app bar and the bottom
  // action bar. The side controls are small floating buttons, NOT full-height
  // panels, so reserving them (as the desktop branch does for the legend) wrongly
  // shrank the width and zoomed the fit far out. Reserve only the two bars.
  if (IS_MOBILE) {
    const topbar = rect(q(".solenoid-topbar"));
    const bar = rect(q(".solenoid-mobile-bar"));
    return {
      top: (topbar ? Math.max(0, topbar.bottom - c.top) : 0) + M,
      bottom: (bar ? Math.max(0, c.bottom - bar.top) : 0) + M,
      left: M,
      right: M,
    };
  }
  const header = rect(q(".solenoid-header"));
  const status = rect(q(".solenoid-statusbar"));
  const left = rect(q(".solenoid-outline")) ?? rect(q(".solenoid-outline__open-pill"));
  let right = 0;
  for (const sel of [".solenoid-legend", ".solenoid-minimap"]) {
    const r = rect(q(sel));
    if (r) right = Math.max(right, c.right - r.left);
  }
  return {
    top: (header ? header.bottom - c.top : 0) + M,
    bottom: (status ? c.bottom - status.top : 0) + M,
    left: (left ? left.right - c.left : 0) + M,
    right: right > 0 ? right + M : M,
  };
}

// Chrome-aware zoom-to-fit: drops hidden members, sizes collapsed groups to
// their compact box, and frames into the free rectangle between the docked
// panels. Exported so Cleanup (C) frames the view identically to
// the navmenu Fit button instead of a raw, chrome-unaware zoomAt.
export async function fitAll() {
  const area = getArea();
  const editor = getEditor();
  if (!area || !editor) return;

  // Bounding box in canvas coords from the SAME geometry the minimap uses:
  // hidden members of a collapsed group are dropped, and a collapsed group is
  // sized to its compact rendered box (not its stored expanded footprint).
  const rects = collapsedAwareNodesRect();
  if (rects.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.left + r.width);
    maxY = Math.max(maxY, r.top + r.height);
  }
  if (!Number.isFinite(minX)) return;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);

  const c = area.container.getBoundingClientRect();
  const ins = visibleInsets(c);
  const availW = Math.max(60, c.width - ins.left - ins.right);
  const availH = Math.max(60, c.height - ins.top - ins.bottom);

  // Fit the box into the free region, with a little slack, clamped.
  const k = Math.max(0.1, Math.min(availW / bw, availH / bh, 1.5) * 0.92);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ax = ins.left + availW / 2;   // free-region center, container coords
  const ay = ins.top + availH / 2;

  await area.area.zoom(k);
  await area.area.translate(ax - cx * k, ay - cy * k);
}

/**
 * Floating canvas-tool cluster (upper-right, vertical): zoom, fit-to-view,
 * the canvas lock, and the decorative cable flourish. These act on the
 * viewport / canvas rather than the document, so they stay on the canvas
 * instead of moving into the TopBar.
 */
export function NavMenu() {
  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  // Fullscreen button is mobile-only (desktop has F11 / Chrome's own). Track the
  // state so the title reflects enter vs exit. Hidden where the browser can't do it
  // (iOS Safari), so it's never a dead button.
  const showFullscreen = IS_MOBILE && fullscreenSupported();
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!showFullscreen) return;
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [showFullscreen]);
  return (
    <div className="solenoid-nav" onPointerDown={(e) => e.stopPropagation()}>
      <button className="solenoid-nav__btn solenoid-nav__btn--zoomin" title="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.4 10.4 14 14" />
          <path d="M7 5 V9 M5 7 H9" />
        </svg>
      </button>
      <button className="solenoid-nav__btn solenoid-nav__btn--zoomout" title="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.4 10.4 14 14" />
          <path d="M5 7 H9" />
        </svg>
      </button>
      <button className="solenoid-nav__btn solenoid-nav__btn--fit" title="Fit all" onClick={() => fitAll()}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5.5 V3 a1 1 0 0 1 1-1 H5.5" />
          <path d="M10.5 2 H13 a1 1 0 0 1 1 1 V5.5" />
          <path d="M14 10.5 V13 a1 1 0 0 1-1 1 H10.5" />
          <path d="M5.5 14 H3 a1 1 0 0 1-1-1 V10.5" />
        </svg>
      </button>
      <button
        className={`solenoid-nav__btn${locked ? " solenoid-nav__btn--on" : ""}`}
        title={locked ? "Unlock canvas" : "Lock canvas"}
        onClick={() => canvasLockStore.toggle()}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3.5" y="7.5" width="9" height="6.5" rx="1.2" />
          {locked
            ? <path d="M5 7.5 V5.2 a3 3 0 0 1 6 0 V7.5" />
            : <path d="M5 7.5 V5.2 a3 3 0 0 1 6 0" />}
        </svg>
      </button>
      {showFullscreen && (
        <button
          className="solenoid-nav__btn solenoid-nav__btn--fullscreen"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => toggleFullscreen()}
        >
          {/* Lucide maximize-2, or minimize-2 while fullscreen — redrawn on the
              pill's 16-grid / 1.5 stroke. */}
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {isFullscreen ? (
              <>
                <path d="M13 7 H9 V3" />
                <path d="M9 7 L14 2" />
                <path d="M3 9 H7 V13" />
                <path d="M7 9 L2 14" />
              </>
            ) : (
              <>
                <path d="M10 2 H14 V6" />
                <path d="M6 14 H2 V10" />
                <path d="M14 2 L9 7" />
                <path d="M2 14 L7 9" />
              </>
            )}
          </svg>
        </button>
      )}
      <button
        className="solenoid-nav__btn solenoid-nav__btn--flourish"
        title="Cable flourish"
        onClick={() => cableFlourishBridge.fire()}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M8 1.4c.45 3.4 1.3 4.25 4.7 4.7-3.4.45-4.25 1.3-4.7 4.7-.45-3.4-1.3-4.25-4.7-4.7 3.4-.45 4.25-1.3 4.7-4.7Z" />
          <path d="M12.4 9.5c.2 1.55.55 1.9 2.1 2.1-1.55.2-1.9.55-2.1 2.1-.2-1.55-.55-1.9-2.1-2.1 1.55-.2 1.9-.55 2.1-2.1Z" />
        </svg>
      </button>
    </div>
  );
}
