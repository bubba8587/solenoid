import type { Area } from "./area";

export function getSocketScreenCenter(
  area: Area,
  nodeId: string,
  socketKey: string,
  side: "input" | "output",
): { x: number; y: number } | null {
  const view = area.nodeViews.get(nodeId);
  if (!view) return null;
  const el = view.element.querySelector(
    `[data-socket-key="${socketKey}"][data-socket-side="${side}"]`,
  ) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function screenToCanvas(
  area: Area,
  container: HTMLElement,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const { x: tx, y: ty, k } = area.transform;
  const r = container.getBoundingClientRect();
  return { x: (sx - r.left - tx) / k, y: (sy - r.top - ty) / k };
}
