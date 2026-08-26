// The ONE size read for layout math — never read offsetWidth directly: a DOM read
// forces a synchronous reflow after any pending write, and a zero-size unpainted
// node collapses the bounding box. The first tier is React Flow's own post-layout
// measure (`area.measured`), which costs nothing.

import type { Surface } from "./surface";
import { collapseStore } from "./collapseStore";
import type { Schemes } from "./schemes";
import type { NodeEditor } from "rete";

type Editor = NodeEditor<Schemes>;
type Area = Surface;

export type NodeBox = { x: number; y: number; w: number; h: number };

// For a node that has never painted and never been measured; single fallback so
// every feature agrees.
export const FALLBACK_NODE_W = 180;
export const FALLBACK_NODE_H = 100;
// Only for an unpainted COLLAPSED node, whose stored height is the taller expanded one.
export const COLLAPSED_NODE_H = 52;

/** A mounted card's size with NO DOM read: RF's measure, else null. */
export function measuredSize(area: Area, id: string): { w: number; h: number } | null {
  const m = area.measured?.(id);
  return m && m.w > 0 && m.h > 0 ? m : null;
}

/** Guaranteed non-zero size; null only when the node has no area view. Tiers: RF's
 *  measure → live rendered size → the ResizeObserver's stored size → a default, with
 *  the fallback tiers COLLAPSE-AWARE. `editor` supplies the stored-size tier. */
export function measuredBox(area: Area, id: string, editor?: Editor): NodeBox | null {
  const v = area.nodeViews.get(id);
  if (!v) return null;
  const m = measuredSize(area, id);
  if (m) return { x: v.position.x, y: v.position.y, w: m.w, h: m.h };
  const liveW = v.element?.offsetWidth || 0;
  const liveH = v.element?.offsetHeight || 0;
  // Once painted the live DOM is the truth and already includes the collapse state.
  if (liveW > 0 && liveH > 0) return { x: v.position.x, y: v.position.y, w: liveW, h: liveH };

  const node = editor?.getNode(id) as { width?: number; height?: number } | undefined;
  const w = liveW || node?.width || FALLBACK_NODE_W;
  const h = collapseStore.get(id)
    ? COLLAPSED_NODE_H
    : (liveH || node?.height || FALLBACK_NODE_H);
  return { x: v.position.x, y: v.position.y, w, h };
}
