import { floorZoom } from "./areaPresets";
// Frame a set of nodes: rete's AreaExtensions.zoomAt math, kept verbatim after
// the rete surface died (0.9 margin, never zooms IN past 1, center-on-bounds).
// Structural surface type so any area-shaped adapter satisfies it.

type NodeLike = { id: string; width?: number; height?: number };

export type ZoomSurface = {
  nodeViews: Map<string, { position: { x: number; y: number }; element: HTMLElement }>;
  container: HTMLElement;
  area: {
    transform: { x: number; y: number; k: number };
    zoom(k: number, ox: number, oy: number): Promise<unknown> | unknown;
  };
};

export async function zoomAt(
  surface: ZoomSurface,
  nodes: ReadonlyArray<NodeLike>,
  params?: { scale?: number },
): Promise<void> {
  const scale = params?.scale ?? 0.9;
  const rects = nodes
    .map((node) => ({ node, view: surface.nodeViews.get(node.id) }))
    .filter((r): r is { node: NodeLike; view: NonNullable<typeof r.view> } => !!r.view)
    .map(({ node, view }) => ({
      x: view.position.x,
      y: view.position.y,
      width: node.width ?? view.element.offsetWidth,
      height: node.height ?? view.element.offsetHeight,
    }));
  if (rects.length === 0) return;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const width = Math.abs(right - left);
  const height = Math.abs(bottom - top);
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const w = surface.container.clientWidth;
  const h = surface.container.clientHeight;
  const k = floorZoom(Math.min((h / height) * scale, (w / width) * scale, 1));
  surface.area.transform.x = w / 2 - center.x * k;
  surface.area.transform.y = h / 2 - center.y * k;
  await surface.area.zoom(k, 0, 0);
}
