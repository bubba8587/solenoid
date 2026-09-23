// [[C43]] oneFlowSurface, [[D64]] oneSizeRead
import { getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { floorZoom, MIN_ZOOM } from "./viewPresets";
import type { View } from "./view";
// Never zooms in past 1; zoom floors to the snap step. Collapsed-group callers: tree/specs/canvas/group-collapse.md.

type NodeLike = { id: string; width?: number; height?: number };

export type ZoomView = Pick<View, "position" | "nodeElement" | "measured" | "container" | "pan" | "zoom">;

const FRAME_PADDING = 0.1;

/** The class default must never outrank RF's measure, or a collapsed card frames at its expanded height. */
export function frameSize(surface: Pick<ZoomView, "measured" | "nodeElement">, node: NodeLike): { width: number; height: number } {
  const m = surface.measured?.(node.id);
  if (m && m.w > 0 && m.h > 0) return { width: m.w, height: m.h };
  const el = surface.nodeElement(node.id);
  // [[D64]] exception: a narrowed surface (measured + nodeElement) so callers outside the flow view can frame; same ladder minus the stored-size tier.
  if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return { width: el.offsetWidth, height: el.offsetHeight };
  return { width: node.width ?? 0, height: node.height ?? 0 };
}

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
      measured: frameSize(surface, node),
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
