import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { getArea, getEditor } from "../process";
import { nodeSizeStore } from "../nodeSizeStore";
import { scheduleAutosave } from "../persistence";
import { nodeResizable } from "../rete-nodes";

// Floors (canvas px). Width drives the card; the card-width floor sits below the
// CSS default (180) on purpose. Height drives only the value box, so its floor
// is a small box minimum — the card auto-sizes around it, so other card elements
// are never hidden no matter how short the box gets.
const MIN_CARD_W = 140;
const MIN_BOX_H = 40;

// The drag lives at MODULE scope and listens on `window`, so the whole gesture
// survives a re-render that recreates this component's DOM (which a per-element
// pointer capture / component ref would not — the drag would die after one
// move). Only one resize can be active at a time.
type Drag = { sx: number; sy: number; startW: number; startH: number; k: number; nodeId: string };
let active: Drag | null = null;

function onMove(e: PointerEvent) {
  if (!active) return;
  nodeSizeStore.set(active.nodeId, {
    w: Math.max(MIN_CARD_W, active.startW + (e.clientX - active.sx) / active.k),
    h: Math.max(MIN_BOX_H, active.startH + (e.clientY - active.sy) / active.k),
  });
}

function onUp() {
  if (!active) return;
  const id = active.nodeId;
  active = null;
  nodeSizeStore.setDragging(false);
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  // One sync now that the drag is done (sockets / minimap / docked FCs).
  void getArea()?.update("node", id);
  scheduleAutosave();
}

/**
 * Corner grip inside a node's value/result box. Dragging resizes the BOX: width
 * is applied to the card (the box fills it), height to the box alone (card
 * height stays content-driven so the header / rows are never covered).
 * Renders nothing for non-resizable nodes.
 */
export function ResizeHandle({ nodeId }: { nodeId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const node = getEditor()?.getNode(nodeId);
  const resizable = !!node && nodeResizable(node);
  if (!resizable) return null;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Block rete's node-drag / area-pan from also starting on this press.
    e.stopPropagation();
    e.preventDefault();
    const area = getArea();
    const card = area?.nodeViews.get(nodeId)?.element;
    // offsetParent is the positioned box the grip sits in — its height is what
    // the drag controls.
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
    // Suppress the node's mid-drag re-render so the box keeps following cleanly.
    nodeSizeStore.setDragging(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return (
    <div
      ref={ref}
      data-resize-handle
      className="solenoid-node__resize-handle"
      title="Drag to resize"
      onPointerDown={onPointerDown}
    >
      <svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true">
        <path d="M7 0 L0 7 M7 3.5 L3.5 7" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  );
}
