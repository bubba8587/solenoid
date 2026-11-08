// [[B3]] sameNodeEverywhere, [[A1]] visualGraphCalculator
import { useCallback, useEffect, useRef } from "react";
import { useNodeId, useStoreApi, type NodeChange } from "@xyflow/react";
import { XYResizer, type ResizeParams, type XYResizerInstance } from "@xyflow/system";
import type { FlowResizeGripProps } from "../flowSurface";

const round = (p: ResizeParams) => ({ width: Math.round(p.width), height: Math.round(p.height) });
const MAX = Number.MAX_VALUE;

/** RF's `NodeResizeControl` markup, driven by `XYResizer` here so a grip never subscribes to the RF store (react-flow-surface-contract § Card sizes). */
export function FlowResizeGrip({
  className, style, minWidth = 10, minHeight = 10, onResizeStart, onResize, onResizeEnd, onDoubleClick, children,
}: FlowResizeGripProps) {
  const nodeId = useNodeId();
  const store = useStoreApi();
  const ref = useRef<HTMLDivElement>(null);
  const resizer = useRef<XYResizerInstance | null>(null);
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

  useEffect(() => {
    const el = ref.current;
    if (!el || !nodeId) return;
    resizer.current = XYResizer({
      domNode: el,
      nodeId,
      getStoreItems: () => {
        const { nodeLookup, transform, snapGrid, snapToGrid, nodeOrigin, domNode } = store.getState();
        return { nodeLookup, transform, snapGrid, snapToGrid, nodeOrigin, paneDomNode: domNode };
      },
      onChange: (change, childChanges) => {
        const changes: NodeChange[] = [];
        if (change.x !== undefined && change.y !== undefined) {
          changes.push({ id: nodeId, type: "position", position: { x: change.x, y: change.y } });
        }
        if (change.width !== undefined && change.height !== undefined) {
          changes.push({ id: nodeId, type: "dimensions", resizing: true, setAttributes: true, dimensions: { width: change.width, height: change.height } });
        }
        for (const child of childChanges) changes.push({ ...child, type: "position" });
        store.getState().triggerNodeChanges(changes);
      },
      onEnd: ({ width, height }) => {
        store.getState().triggerNodeChanges([{ id: nodeId, type: "dimensions", resizing: false, dimensions: { width, height } }]);
      },
    });
    return () => {
      resizer.current?.destroy();
      resizer.current = null;
    };
  }, [nodeId, store]);

  useEffect(() => {
    resizer.current?.update({
      controlPosition: "bottom-right",
      boundaries: { minWidth, minHeight, maxWidth: MAX, maxHeight: MAX },
      keepAspectRatio: false,
      resizeDirection: undefined,
      onResizeStart: start,
      onResize: resize,
      onResizeEnd: end,
      shouldResize: undefined,
    });
  }, [nodeId, store, minWidth, minHeight, start, resize, end]);

  return (
    <div ref={ref} className={`react-flow__resize-control nodrag bottom right handle sol-rf-grip${className ? ` ${className}` : ""}`} style={style}>
      {/* The card grip draws its mark as a ::before on the control itself — no child box
          beside it in the 16px flex row. */}
      {children !== undefined && <div className="sol-rf-grip__mark" onDoubleClick={onDoubleClick}>{children}</div>}
    </div>
  );
}
