import { getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { floorZoom, MIN_ZOOM } from "./areaPresets";
// Frame a set of nodes (React Flow's bounds + viewport math; never zooms IN past 1,
// zoom floored to the snap step). Structural surface type so any area-shaped adapter
// satisfies it.

type NodeLike = { id: string; width?: number; height?: number };

export type ZoomSurface = {
  nodeViews: Map<string, { position: { x: number; y: number }; element: HTMLElement }>;
  measured?(id: string): { w: number; h: number } | undefined;
  container: HTMLElement;
  area: {
    transform: { x: number; y: number; k: number };
    zoom(k: number, ox: number, oy: number): Promise<unknown> | unknown;
  };
};

/** RF's padding is a fraction of the framed bounds; 0.1 leaves the rete-era 0.9 margin. */
const FRAME_PADDING = 0.1;

export async function zoomAt(
  surface: ZoomSurface,
  nodes: ReadonlyArray<NodeLike>,
  params?: { padding?: number },
): Promise<void> {
  const lites = nodes
    .map((node) => ({ node, view: surface.nodeViews.get(node.id) }))
    .filter((r): r is { node: NodeLike; view: NonNullable<typeof r.view> } => !!r.view)
    .map(({ node, view }) => ({
      id: node.id,
      position: { x: view.position.x, y: view.position.y },
      measured: {
        width: node.width ?? surface.measured?.(node.id)?.w ?? view.element.offsetWidth,
        height: node.height ?? surface.measured?.(node.id)?.h ?? view.element.offsetHeight,
      },
      data: {},
    }));
  if (lites.length === 0) return;
  const bounds = getNodesBounds(lites);
  const w = surface.container.clientWidth;
  const h = surface.container.clientHeight;
  const k = floorZoom(getViewportForBounds(bounds, w, h, MIN_ZOOM, 1, params?.padding ?? FRAME_PADDING).zoom);
  surface.area.transform.x = w / 2 - (bounds.x + bounds.width / 2) * k;
  surface.area.transform.y = h / 2 - (bounds.y + bounds.height / 2) * k;
  await surface.area.zoom(k, 0, 0);
}
