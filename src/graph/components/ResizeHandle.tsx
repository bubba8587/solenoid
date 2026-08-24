import { useRef, type PointerEvent as ReactPointerEvent } from "react";
// Active/owning accessors, not getEditor/getArea — a node inside a composite drill-in
// isn't in the MAIN editor, so the grip wouldn't render and the zoom would be wrong.
import { getOwningEditor, getActiveArea } from "../activeGraph";
import { nodeSizeStore } from "../nodeSizeStore";
import { scheduleAutosave } from "../persistence";
import { nodeResizable } from "../rete-nodes";

// Floors (canvas px). The card-width floor sits below the CSS default (180) on purpose;
// the height floor bounds only the value box, so no card element can ever be hidden.
const MIN_CARD_W = 140;
const MIN_BOX_H = 40;

// The drag lives at MODULE scope and listens on `window` so it survives a re-render
// that recreates this component's DOM; a pointer capture would die after one move.
type Drag = { sx: number; sy: number; startW: number; startH: number; k: number; nodeId: string };
let active: Drag | null = null;

function onMove(e: PointerEvent) {
  if (!active) return;
  const min = nodeSizeStore.getMin(active.nodeId);
  const minW = Math.max(MIN_CARD_W, min?.w ?? 0);
  const minH = Math.max(MIN_BOX_H, min?.h ?? 0);
  nodeSizeStore.set(active.nodeId, {
    // Integer dims — a fractional size renders the inset:-2px selection ring 0.5px off.
    w: Math.round(Math.max(minW, active.startW + (e.clientX - active.sx) / active.k)),
    h: Math.round(Math.max(minH, active.startH + (e.clientY - active.sy) / active.k)),
  });
}

function onUp() {
  if (!active) return;
  const id = active.nodeId;
  active = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  void getActiveArea()?.update("node", id);
  scheduleAutosave();
}

/** Width is applied to the card, height to the value box alone — card height stays
 *  content-driven so the header / rows are never covered. */
export function ResizeHandle({ nodeId }: { nodeId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const node = getOwningEditor(nodeId)?.getNode(nodeId);
  const resizable = !!node && nodeResizable(node);
  if (!resizable) return null;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Block rete's node-drag / area-pan from also starting on this press.
    e.stopPropagation();
    e.preventDefault();
    const area = getActiveArea();
    const card = area?.nodeViews.get(nodeId)?.element;
    // offsetParent is the positioned box the grip sits in — the height the drag controls.
    const box = ref.current?.offsetParent as HTMLElement | null;
    if (!area || !card || !box) return;
    const k = area.area.transform.k || 1;
    active = {
      sx: e.clientX,
      sy: e.clientY,
      startW: card.getBoundingClientRect().width / k,
      startH: box.getBoundingClientRect().height / k,
      k,
      nodeId,
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div
      ref={ref}
      data-resize-handle
      className="solenoid-node__resize-handle"
      onPointerDown={onPointerDown}
    />
  );
}

// The corner-grip glyph is a masked ::before in nodeCard.css, shared with
// .solenoid-field-resize so every resize affordance stays the same mark.
