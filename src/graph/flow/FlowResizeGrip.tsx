// [[C43]] oneFlowSurface, [[B10]] reactFlowView
import { useCallback, useRef } from "react";
import { NodeResizeControl, type ResizeParams } from "@xyflow/react";
import type { FlowResizeGripProps } from "../flowSurface";

const round = (p: ResizeParams) => ({ width: Math.round(p.width), height: Math.round(p.height) });

export function FlowResizeGrip({
  className, style, minWidth, minHeight, onResizeStart, onResize, onResizeEnd, onDoubleClick, children,
}: FlowResizeGripProps) {
  // The callbacks handed to RF must keep their identity: NodeResizeControl rebinds its d3 drag on change, which drops an in-flight touch.
  const latest = useRef({ onResizeStart, onResize, onResizeEnd });
  latest.current = { onResizeStart, onResize, onResizeEnd };
  // RF 12.12 fires onResizeEnd after a bare click too; a click (or the group grip's autofit double-click) is not a resize.
  const moved = useRef(false);
  const start = useCallback((_e: unknown, p: ResizeParams) => {
    moved.current = false;
    latest.current.onResizeStart?.(round(p));
  }, []);
  const resize = useCallback((_e: unknown, p: ResizeParams) => {
    moved.current = true;
    latest.current.onResize(round(p));
  }, []);
  const end = useCallback((_e: unknown, p: ResizeParams) => {
    if (moved.current) latest.current.onResizeEnd?.(round(p));
    moved.current = false;
  }, []);
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
