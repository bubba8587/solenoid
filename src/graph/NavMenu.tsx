// [[C88]] collapsedGroupCard (collapsedAwareNodesRect), [[C92]] pinchUnvetoable
import { floorZoom } from "./viewPresets";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { getActiveView, getActiveEditor } from "./activeGraph";
import { collapsedAwareNodesRect } from "./components/Minimap";
import { canvasLockStore } from "./canvasLock";
import { cableFlourishBridge } from "./cableFlourishStore";
import { IS_COARSE, isMobile, deviceModeStore, prefersReducedMotion } from "./coarse";
import { fullscreenSupported, toggleFullscreen } from "./fullscreen";
import { clamp } from "./nodes/mathUtils";
import "./NavMenu.css";

// Per-click zoom factor for the +/− pill buttons; the wheel/pinch stay fine-grained.
const ZOOM_STEP = 1.4;

async function zoomBy(delta: number) {
  const view = getActiveView();
  if (!view) return;
  const { k, x, y } = view.transform;
  const next = clamp(k * delta, 0.1, 4);
  if (next === k) return;
  // `view.zoom` adds (ox, oy) after scaling; keeping screen point (cx, cy) fixed gives dx = (cx − x) * (1 − next/k).
  const rect = view.container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const ratio = 1 - next / k;
  await view.zoom(next, (cx - x) * ratio, (cy - y) * ratio);
}

// Fit into the free rectangle between the live chrome rects, not under the header or behind side panels.
function visibleInsets(c: DOMRect) {
  const q = (s: string) => document.querySelector(s) as HTMLElement | null;
  // A display:none panel reports an all-zero rect at (0,0), which would read as a real edge.
  const rect = (el: HTMLElement | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? null : r;
  };
  const M = 14; // breathing margin off each panel
  // Mobile chrome is two full-width edges; its small floating side buttons reserve nothing.
  if (isMobile()) {
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

// Chrome-aware zoom-to-fit, also run by Cleanup.
export async function fitAll() {
  const view = getActiveView();
  const editor = getActiveEditor();
  if (!view || !editor) return;

  // The minimap's geometry: hidden members dropped, a collapsed group at its compact box.
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

  const c = view.container.getBoundingClientRect();
  const ins = visibleInsets(c);
  const availW = Math.max(60, c.width - ins.left - ins.right);
  const availH = Math.max(60, c.height - ins.top - ins.bottom);

  const k = floorZoom(Math.min(availW / bw, availH / bh, 1.5) * 0.92);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ax = ins.left + availW / 2;   // free-region center, container coords
  const ay = ins.top + availH / 2;

  await view.zoom(k);
  await view.pan(ax - cx * k, ay - cy * k);
}

/** The phone's nav pill tucked into its edge handle, kept per viewer. */
const TUCK_KEY = "solenoid.navTucked";
function readTucked(): boolean {
  try { return localStorage.getItem(TUCK_KEY) === "1"; } catch { return false; }
}
function writeTucked(on: boolean): void {
  try { localStorage.setItem(TUCK_KEY, on ? "1" : "0"); } catch { /* a private window keeps it for the session only */ }
}

/** How far a swipe right must carry the pill to tuck it, and how far a finger moves before a press is a swipe. */
const TUCK_AT = 40;
const SWIPE_SLOP = 8;

/** A sideways swipe on an element: `onMove` follows the finger once it is a swipe, `onEnd` gets the travel. A swipe
 *  swallows the click that would follow it, so a swipe that starts on a button never presses it. */
function useSideSwipe(onMove: (dx: number) => void, onEnd: (dx: number) => void) {
  const d = useRef<{ x: number; y: number; dx: number; swiping: boolean } | null>(null);
  const swallow = useRef(false);
  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.stopPropagation();
      d.current = { x: e.clientX, y: e.clientY, dx: 0, swiping: false };
      swallow.current = false;
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const s = d.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (!s.swiping) {
        if (Math.abs(dx) < SWIPE_SLOP || Math.abs(dx) < Math.abs(e.clientY - s.y)) return;
        s.swiping = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      s.dx = dx;
      onMove(dx);
    },
    onPointerUp() {
      const s = d.current;
      d.current = null;
      if (s?.swiping) {
        swallow.current = true;
        onEnd(s.dx);
      }
    },
    onPointerCancel() {
      const s = d.current;
      d.current = null;
      if (s?.swiping) onEnd(0);
    },
    onClickCapture(e: React.MouseEvent) {
      if (!swallow.current) return;
      swallow.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}

export function NavMenu() {
  const mobile = useSyncExternalStore(deviceModeStore.subscribe, deviceModeStore.get);
  const [tucked, setTucked] = useState(readTucked);
  const pill = useRef<HTMLDivElement>(null);
  const tuck = (on: boolean) => { setTucked(on); writeTucked(on); };
  const pillSwipe = useSideSwipe(
    (dx) => {
      const el = pill.current;
      if (!el) return;
      el.classList.remove("solenoid-nav--settling");
      // Only rightward, toward the edge it tucks into.
      el.style.transform = `translateX(${Math.max(0, dx)}px)`;
    },
    (dx) => {
      const el = pill.current;
      if (!el) return;
      el.classList.add("solenoid-nav--settling");
      if (dx < TUCK_AT) { el.style.transform = ""; return; }
      if (prefersReducedMotion()) { el.style.transform = ""; tuck(true); return; }
      el.style.transform = "translateX(calc(100% + 16px))";
      window.setTimeout(() => { el.style.transform = ""; el.classList.remove("solenoid-nav--settling"); tuck(true); }, 140);
    },
  );
  const handleSwipe = useSideSwipe(() => {}, (dx) => { if (dx < -SWIPE_SLOP) tuck(false); });
  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  // Shown on any touch-primary device (IS_COARSE; no F11 there), and hidden where the browser can't go fullscreen.
  const showFullscreen = IS_COARSE && fullscreenSupported();
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (!showFullscreen) return;
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [showFullscreen]);
  if (mobile && tucked) {
    return (
      <button
        className="solenoid-nav-handle"
        title="Show the canvas controls"
        aria-label="Show the canvas controls"
        onClick={() => tuck(false)}
        {...handleSwipe}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3.5 L5.5 8 L10 12.5" />
        </svg>
      </button>
    );
  }
  return (
    <div ref={pill} className="solenoid-nav" {...(mobile ? pillSwipe : { onPointerDown: (e: ReactPointerEvent) => e.stopPropagation() })}>
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
        {/* viewBox y-shifted +0.7: the body-heavy glyph's ink centroid measured
            +0.73 below the box center, so it read low (the pushpin precedent —
            archived dev-notes 2026-06-20). */}
        <svg viewBox="0 0.7 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
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
