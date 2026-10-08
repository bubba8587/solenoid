// [[C93]] gestureByPointerType
import { type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { getActiveView } from "../activeGraph";

// Clamped here, not by the CSS min-height: the browser keeps shrinking the inline value past it, so the height stops responding while the pointer goes on.
const MIN_FIELD_H = 64;
// The card's CSS width is its floor; past the ceiling a field belongs in a popup.
const MIN_CARD_W = 180;
const MAX_CARD_W = 900;

// Module scope, like the card grip's drag: a re-render that recreates this DOM must not drop the gesture.
type Drag = {
  sx: number; sy: number; k: number;
  el: HTMLElement; startH: number; minH: number;
  card: HTMLElement | null; startW: number;
  onResize?: (h: number) => void;
};
let active: Drag | null = null;

function onMove(e: PointerEvent) {
  if (!active) return;
  const h = Math.round(Math.max(active.minH, active.startH + (e.clientY - active.sy) / active.k));
  active.el.style.height = `${h}px`;
  active.onResize?.(h);
  if (active.card) {
    const w = Math.min(MAX_CARD_W, Math.max(MIN_CARD_W, active.startW + (e.clientX - active.sx) / active.k));
    active.card.style.width = `${Math.round(w)}px`;
  }
}

function onUp() {
  if (!active) return;
  active = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
}

/** Replaces the UA resize corner, whose bright glyph no CSS retires (`::-webkit-resizer` paints behind it). Sizes are live DOM, never persisted.
 *  `both` also drags the card's width sideways; `onResize` tells a field that sizes itself to its text which height the user dragged to, so its next grow keeps it. */
export function FieldResizeGrip({ targetRef, onResize, axes = "y", minHeight = MIN_FIELD_H }: {
  targetRef: RefObject<HTMLElement | null>;
  onResize?: (h: number) => void;
  axes?: "y" | "both";
  minHeight?: number;
}) {
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // The grip vetoes the card drag and the pan ([[C93]] gestureByPointerType).
    e.stopPropagation();
    e.preventDefault();
    const el = targetRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const k = getActiveView()?.transform.k || 1;
    const card = axes === "both" ? el.closest<HTMLElement>(".solenoid-node") : null;
    active = {
      sx: e.clientX, sy: e.clientY, k,
      el, startH: el.getBoundingClientRect().height / k, minH: minHeight,
      card, startW: card ? card.getBoundingClientRect().width / k : 0,
      onResize,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div
      className={`solenoid-field-resize nodrag nopan${axes === "both" ? " solenoid-field-resize--both" : ""}`}
      title="Resize"
      onPointerDown={onPointerDown}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
