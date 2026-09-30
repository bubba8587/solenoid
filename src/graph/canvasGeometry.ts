// [[C43]] oneFlowSurface
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

/** A socket's center in its card's own layout coordinates, summed up the offset chain. A screen rect divided by the
 *  zoom is quantized by the zoom, so the same socket measured at two zooms differs by a fraction of a pixel, which is
 *  enough to change a layout; layout offsets never see the zoom. Null when the socket is not drawn. */
export function socketLocalCenter(
  view: View,
  nodeId: string,
  socketKey: string,
  side: "input" | "output",
): { x: number; y: number } | null {
  const card = view.nodeElement(nodeId);
  const el = card?.querySelector(`[data-socket-key="${socketKey}"][data-socket-side="${side}"]`) as HTMLElement | null;
  if (!card || !el) return null;
  let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
  let cur: HTMLElement | null = el;
  while (cur && cur !== card) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return cur === card ? { x, y } : null;
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
