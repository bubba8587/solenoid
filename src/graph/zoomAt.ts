import { getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { floorZoom, MIN_ZOOM } from "./viewPresets";
import type { View } from "./view";
// Frame a set of nodes (React Flow's bounds + viewport math; never zooms IN past 1,
// zoom floored to the snap step).

type NodeLike = { id: string; width?: number; height?: number };

export type ZoomView = Pick<View, "position" | "nodeElement" | "measured" | "container" | "pan" | "zoom">;

/** RF's padding is a fraction of the framed bounds; 0.1 leaves the rete-era 0.9 margin. */
const FRAME_PADDING = 0.1;

export async function zoomAt(
  surface: ZoomView,
  nodes: ReadonlyArray<NodeLike>,
  params?: { padding?: number },
): Promise<void> {
  const lites = nodes
    .map((node) => ({ node, position: surface.position(node.id) }))
    .filter((r): r is { node: NodeLike; position: NonNullable<typeof r.position> } => !!r.position)
    .map(({ node, position }) => ({
      id: node.id,
      position: { x: position.x, y: position.y },
      measured: {
        width: node.width ?? surface.measured?.(node.id)?.w ?? surface.nodeElement(node.id)?.offsetWidth ?? 0,
        height: node.height ?? surface.measured?.(node.id)?.h ?? surface.nodeElement(node.id)?.offsetHeight ?? 0,
      },
      data: {},
    }));
  if (lites.length === 0) return;
  const bounds = getNodesBounds(lites);
  const w = surface.container.clientWidth;
  const h = surface.container.clientHeight;
  const k = floorZoom(getViewportForBounds(bounds, w, h, MIN_ZOOM, 1, params?.padding ?? FRAME_PADDING).zoom);
  await surface.pan(w / 2 - (bounds.x + bounds.width / 2) * k, h / 2 - (bounds.y + bounds.height / 2) * k);
  await surface.zoom(k);
}
