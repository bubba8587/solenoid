// The corner resize grip on the flow surface: RF's NodeResizeControl (pointer + touch
// drag, zoom-aware, snapToGrid live) wearing the app's own grip mark. Sizes are
// integers — a fractional size renders the inset:-2px selection ring 0.5px off. The
// resizer's own dimension changes never reach RF state (FlowSurface drops them): the
// MODEL owns a card's size, and RF re-measures the card like any other render.
import { useCallback, useRef } from "react";
import { NodeResizeControl, type ResizeParams } from "@xyflow/react";
import type { FlowResizeGripProps } from "../flowSurface";

const round = (p: ResizeParams) => ({ width: Math.round(p.width), height: Math.round(p.height) });

export function FlowResizeGrip({
  className, style, minWidth, minHeight, onResizeStart, onResize, onResizeEnd, onDoubleClick, children,
}: FlowResizeGripProps) {
  // The callbacks handed to RF MUST keep their identity across renders: NodeResizeControl
  // rebinds its d3 drag handler whenever they change, which drops an in-flight TOUCH
  // gesture (the touchmove listener lives on the element; a mouse's lives on the window).
  // Every resize step re-renders the card, so per-render arrows resized once and stopped.
  const latest = useRef({ onResizeStart, onResize, onResizeEnd });
  latest.current = { onResizeStart, onResize, onResizeEnd };
  const start = useCallback((_e: unknown, p: ResizeParams) => latest.current.onResizeStart?.(round(p)), []);
  const resize = useCallback((_e: unknown, p: ResizeParams) => latest.current.onResize(round(p)), []);
  const end = useCallback((_e: unknown, p: ResizeParams) => latest.current.onResizeEnd?.(round(p)), []);
  return (
    <NodeResizeControl
      position="bottom-right"
      autoScale={false}
      minWidth={minWidth}
      minHeight={minHeight}
      className={`sol-rf-grip${className ? ` ${className}` : ""}`}
      style={style}
      onResizeStart={start}
      onResize={resize}
      onResizeEnd={end}
    >
      {/* The card grip draws its mark as a ::before on the control itself — no child box
          beside it in the 16px flex row. */}
      {children !== undefined && <div className="sol-rf-grip__mark" onDoubleClick={onDoubleClick}>{children}</div>}
    </NodeResizeControl>
  );
}
