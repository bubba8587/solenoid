// [[components#One design system governs every look, layout and word in the app]]
// The phone's tuck: a sideways swipe slides a floating piece of chrome off to a screen edge, where a handle on its
// own side stays in view, and pulls it back (layout-chrome § Mobile, touch-gestures).
import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** How far a finger moves before a press is a swipe. */
const SWIPE_SLOP = 8;

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
export function useSideSwipe(onMove: (dx: number) => void, onEnd: (dx: number) => void) {
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
