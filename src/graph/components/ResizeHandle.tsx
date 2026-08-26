import { useRef } from "react";
// Owning accessors, not getEditor/getArea — a node inside a composite drill-in isn't
// in the MAIN editor, so the grip wouldn't render.
import { getOwningEditor, getActiveArea } from "../activeGraph";
import { useFlowResizeGrip } from "../flowSurface";
import { nodeSizeStore } from "../nodeSizeStore";
import { scheduleAutosave } from "../persistence";
import { nodeResizable } from "../rete-nodes";

// Floors (canvas px). The card-width floor sits below the CSS default (180) on purpose;
// the height floor bounds only the value box, so no card element can ever be hidden.
const MIN_CARD_W = 140;
const MIN_BOX_H = 40;

/** Width is applied to the card, height to the value box alone — card height stays
 *  content-driven so the header / rows are never covered. The grip reports the CARD's
 *  size, so the box follows the height delta from the drag's start. */
export function ResizeHandle({ nodeId }: { nodeId: string }) {
  const Grip = useFlowResizeGrip();
  const start = useRef<{ cardH: number; boxH: number } | null>(null);
  const node = getOwningEditor(nodeId)?.getNode(nodeId);
  const resizable = !!node && nodeResizable(node);
  if (!resizable || !Grip) return null;

  const onResizeStart = (size: { width: number; height: number }) => {
    // --box-h is the body's CSS height (its padding sits outside it); clientHeight is
    // layout px, so no zoom division.
    const box = getActiveArea()?.nodeViews.get(nodeId)?.element.querySelector<HTMLElement>(".solenoid-node__body");
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
    void getActiveArea()?.update("node", nodeId);
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

// The corner-grip glyph is a masked ::before in nodeCard.css, shared with
// .solenoid-field-resize so every resize affordance stays the same mark.
