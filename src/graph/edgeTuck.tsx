// [[B14]] oneDesignSystem
// The phone's tuck: a swipe toward a screen edge slides a floating piece of chrome off into a half-pill handle on that
// edge, and a tap or a swipe back out on the handle brings it back (layout-chrome § Mobile, touch-gestures).
import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { prefersReducedMotion } from "./coarse";
import "./edgeTuck.css";

export type Edge = "left" | "right";

/** How far a swipe must carry a piece to tuck it, and how far a finger moves before a press is a swipe. */
const TUCK_AT = 40;
const SWIPE_SLOP = 8;
const SLIDE_MS = 140;

/** A tuck kept per viewer, under its own key. */
export function useTuckState(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return false; }
  });
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* a private window keeps it for the session only */ }
  };
  return [on, set];
}

/** A sideways swipe: `onMove` follows the finger once it is a swipe, `onEnd` gets the travel. A swipe swallows the
 *  click that would follow it, so a swipe that starts on a button never presses it. */
function useSideSwipe(onMove: (dx: number) => void, onEnd: (dx: number) => void) {
  const d = useRef<{ x: number; y: number; dx: number; swiping: boolean } | null>(null);
  const swallow = useRef(false);
  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      e.stopPropagation();
      // A drag in a text field moves its caret or selection, never the piece.
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) { d.current = null; return; }
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
    onClickCapture(e: ReactMouseEvent) {
      if (!swallow.current) return;
      swallow.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}

/** The swipe handlers for a piece that tucks toward `edge`: it follows the finger that way only, springs back short of
 *  the threshold, and past it slides off before `onTuck`. */
export function useTuckSwipe(ref: RefObject<HTMLElement | null>, edge: Edge, onTuck: () => void) {
  const sign = edge === "right" ? 1 : -1;
  return useSideSwipe(
    (dx) => {
      const el = ref.current;
      if (!el) return;
      el.classList.remove("solenoid-tuck--settling", "solenoid-tuck--entering");
      el.style.transform = `translateX(${sign * Math.max(0, sign * dx)}px)`;
    },
    (dx) => {
      const el = ref.current;
      if (!el) return;
      el.classList.add("solenoid-tuck--settling");
      if (sign * dx < TUCK_AT) { el.style.transform = ""; return; }
      if (prefersReducedMotion()) { el.style.transform = ""; onTuck(); return; }
      el.style.transform = `translateX(calc(${sign} * (100% + 16px)))`;
      window.setTimeout(() => {
        el.style.transform = "";
        el.classList.remove("solenoid-tuck--settling");
        onTuck();
      }, SLIDE_MS);
    },
  );
}

/** The class a piece wears for one slide back out from its edge; it drops itself when the animation ends. */
export function enteringClass(edge: Edge, entering: boolean): string {
  return entering ? ` solenoid-tuck--entering solenoid-tuck--from-${edge}` : "";
}

/** The half-pill on a screen edge that stands in for a tucked piece: rounded on the inside, flat against the edge,
 *  a chevron pointing back in. A tap or a swipe away from the edge brings the piece back. */
export function EdgeHandle({ edge, label, className, style, onOpen }: {
  edge: Edge;
  label: string;
  className?: string;
  style?: CSSProperties;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const out = edge === "right" ? -1 : 1;
  const swipe = useSideSwipe(
    (dx) => {
      const el = ref.current;
      if (el) el.style.transform = `translateX(${out * Math.min(24, Math.max(0, out * dx))}px)`;
    },
    (dx) => {
      const el = ref.current;
      if (el) el.style.transform = "";
      if (out * dx >= SWIPE_SLOP) onOpen();
    },
  );
  return (
    <button
      ref={ref}
      className={`solenoid-edge-handle solenoid-edge-handle--${edge}${className ? ` ${className}` : ""}`}
      style={style}
      title={label}
      aria-label={label}
      onClick={onOpen}
      {...swipe}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={edge === "right" ? "M10 3.5 L5.5 8 L10 12.5" : "M6 3.5 L10.5 8 L6 12.5"} />
      </svg>
    </button>
  );
}
