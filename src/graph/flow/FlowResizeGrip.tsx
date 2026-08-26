// The corner resize grip on the flow surface: RF's NodeResizeControl (pointer + touch
// drag, zoom-aware, snapToGrid live) wearing the app's own grip mark. Sizes are
// integers — a fractional size renders the inset:-2px selection ring 0.5px off. The
// resizer's own dimension changes never reach RF state (FlowSurface drops them): the
// MODEL owns a card's size, and RF re-measures the card like any other render.
import { NodeResizeControl, type ResizeParams } from "@xyflow/react";
import type { FlowResizeGripProps } from "../flowSurface";

const round = (p: ResizeParams) => ({ width: Math.round(p.width), height: Math.round(p.height) });

export function FlowResizeGrip({
  className, style, minWidth, minHeight, onResizeStart, onResize, onResizeEnd, onDoubleClick, children,
}: FlowResizeGripProps) {
  return (
    <NodeResizeControl
      position="bottom-right"
      autoScale={false}
      minWidth={minWidth}
      minHeight={minHeight}
      className={`sol-rf-grip${className ? ` ${className}` : ""}`}
      style={style}
      onResizeStart={onResizeStart ? (_e, p) => onResizeStart(round(p)) : undefined}
      onResize={(_e, p) => onResize(round(p))}
      onResizeEnd={onResizeEnd ? (_e, p) => onResizeEnd(round(p)) : undefined}
    >
      <div className="sol-rf-grip__mark" onDoubleClick={onDoubleClick}>{children}</div>
    </NodeResizeControl>
  );
}
