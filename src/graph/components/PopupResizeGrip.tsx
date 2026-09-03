import { type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clamp } from "../nodes/mathUtils";

// The corner resize grip for a centered popup — the screen-space sibling of the
// canvas FieldResizeGrip (same module-scope drag so a re-render mid-gesture can't
// drop it, same `.solenoid-field-resize` mark). A popup is CENTERED by its overlay,
// so growth is symmetric about the center: both edges move, which means the card
// grows by TWICE the pointer delta and the corner under the pointer tracks it.

export type PopupSize = { w: number; h: number };

// Leave the overlay's 10px padding on each side.
const VIEWPORT_MARGIN = 20;

type Drag = { sx: number; sy: number; startW: number; startH: number; min: PopupSize; set: (s: PopupSize) => void };
let active: Drag | null = null;

function onMove(e: PointerEvent) {
  if (!active) return;
  const w = clamp(active.startW + (e.clientX - active.sx) * 2, active.min.w, window.innerWidth - VIEWPORT_MARGIN);
  const h = clamp(active.startH + (e.clientY - active.sy) * 2, active.min.h, window.innerHeight - VIEWPORT_MARGIN);
  active.set({ w: Math.round(w), h: Math.round(h) });
}

function onUp() {
  if (!active) return;
  active = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
}

export function PopupResizeGrip({ cardRef, min, onResize }: {
  cardRef: RefObject<HTMLElement | null>;
  min: PopupSize;
  onResize: (s: PopupSize) => void;
}) {
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Don't let the press reach the overlay (which closes) or start a text selection.
    e.stopPropagation();
    e.preventDefault();
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    active = { sx: e.clientX, sy: e.clientY, startW: r.width, startH: r.height, min, set: onResize };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return <div className="sol-popup__resize" title="Resize" onPointerDown={onPointerDown} />;
}
