import { useRef } from "react";
// Owning accessors: a node inside a drill-in isn't in the main editor, so the grip wouldn't render.
import { getOwningEditor, getActiveView } from "../activeGraph";
import { useFlowResizeGrip } from "../flowSurface";
import { nodeSizeStore } from "../nodeSizeStore";
import { scheduleAutosave } from "../persistence";
import { nodeResizable } from "../rete-nodes";

// The width floor sits below the CSS default (180) on purpose; the height floor bounds only the value box.
const MIN_CARD_W = 140;
const MIN_BOX_H = 40;

/** The grip reports the card's size, so the box follows the height delta from the drag's start; the size rides `nodeSizeStore`. */
export function ResizeHandle({ nodeId }: { nodeId: string }) {
  const Grip = useFlowResizeGrip();
  const start = useRef<{ cardH: number; boxH: number } | null>(null);
  const node = getOwningEditor(nodeId)?.getNode(nodeId);
  const resizable = !!node && nodeResizable(node);
  if (!resizable || !Grip) return null;

  const onResizeStart = (size: { width: number; height: number }) => {
    // --box-h is the body's CSS height (padding outside it); clientHeight is layout px, so no zoom division.
    const box = getActiveView()?.nodeElement(nodeId)?.querySelector<HTMLElement>(".solenoid-node__body");
    let boxH = size.height;
    if (box) {
      const cs = getComputedStyle(box);
      boxH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    }
    start.current = { cardH: size.height, boxH };
  };
  const onResize = (size: { width: number; height: number }) => {
    const s = start.current;
    if (!s) return;
    const min = nodeSizeStore.getMin(nodeId);
    const minW = Math.max(MIN_CARD_W, min?.w ?? 0);
    const minH = Math.max(MIN_BOX_H, min?.h ?? 0);
    nodeSizeStore.set(nodeId, {
      w: Math.max(minW, size.width),
      h: Math.round(Math.max(minH, s.boxH + (size.height - s.cardH))),
    });
  };
  const onResizeEnd = () => {
    start.current = null;
    void getActiveView()?.rerenderNode(nodeId);
    scheduleAutosave();
  };

  return (
    <Grip
      className="solenoid-node__resize-handle"
      minWidth={MIN_CARD_W}
      onResizeStart={onResizeStart}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
    />
  );
}

