// Screen ↔ canvas coordinate helpers shared by canvas-surface features
// (FC docking, quick-wire placement). Pure DOM reads over the rete area.
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";

export function getSocketScreenCenter(
  area: AreaPlugin<Schemes, AreaExtra>,
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
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const { x: tx, y: ty, k } = area.area.transform;
  const r = container.getBoundingClientRect();
  return { x: (sx - r.left - tx) / k, y: (sy - r.top - ty) / k };
}
