import { type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { getActiveArea } from "../activeGraph";

// Canvas-px floor, mirroring the `min-height` the field carries in CSS. The drag
// clamps here rather than leaning on min-height: the browser would keep shrinking
// the inline value past the clamp, so the rendered height stops responding while
// the pointer keeps going.
const MIN_FIELD_H = 64;

// Module-scope like the card grip's drag: a re-render that recreates this
// component's DOM must not drop the gesture.
type Drag = { sy: number; startH: number; k: number; el: HTMLElement };
let active: Drag | null = null;

function onMove(e: PointerEvent) {
  if (!active) return;
  const next = Math.max(MIN_FIELD_H, active.startH + (e.clientY - active.sy) / active.k);
  active.el.style.height = `${Math.round(next)}px`;
}

function onUp() {
  if (!active) return;
  active = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
}

/** Vertical resize grip for a text field, replacing the UA `resize: vertical`
 *  corner. The native control drags correctly but paints its own bright glyph
 *  that no CSS can retire (`::-webkit-resizer` paints BEHIND it), so the field
 *  sets `resize: none` and wears this instead — the same mark as the card grip.
 *  Height is a live DOM size, not persisted, exactly as the native resizer left it. */
export function FieldResizeGrip({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Keep rete's node-drag / area-pan from starting on the same press.
    e.stopPropagation();
    e.preventDefault();
    const el = targetRef.current;
    if (!el) return;
    const k = getActiveArea()?.area.transform.k || 1;
    active = { sy: e.clientY, startH: el.getBoundingClientRect().height / k, k, el };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div className="solenoid-field-resize" onPointerDown={onPointerDown} />
  );
}
