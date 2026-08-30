import type { View } from "./view";

export function getSocketScreenCenter(
  view: View,
  nodeId: string,
  socketKey: string,
  side: "input" | "output",
): { x: number; y: number } | null {
  const card = view.nodeElement(nodeId);
  if (!card) return null;
  const el = card.querySelector(
    `[data-socket-key="${socketKey}"][data-socket-side="${side}"]`,
  ) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function screenToCanvas(
  view: View,
  container: HTMLElement,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const { x: tx, y: ty, k } = view.transform;
  const r = container.getBoundingClientRect();
  return { x: (sx - r.left - tx) / k, y: (sy - r.top - ty) / k };
}
