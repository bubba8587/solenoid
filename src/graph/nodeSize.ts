// The ONE size read for layout math — never read offsetWidth directly: a DOM read
// forces a synchronous reflow after any pending write, and a zero-size unpainted
// node collapses the bounding box. The first tier is React Flow's own post-layout
// measure (`area.measured`), which costs nothing.

import type { View } from "./view";
import { collapseStore } from "./collapseStore";
import type { Schemes } from "./schemes";
import type { NodeEditor } from "rete";

type Editor = NodeEditor<Schemes>;

export type NodeBox = { x: number; y: number; w: number; h: number };

// For a node that has never painted and never been measured; single fallback so
// every feature agrees.
export const FALLBACK_NODE_W = 180;
export const FALLBACK_NODE_H = 100;
// Only for an unpainted COLLAPSED node, whose stored height is the taller expanded one.
export const COLLAPSED_NODE_H = 52;

/** A mounted card's size with NO DOM read: RF's measure, else null. */
export function measuredSize(view: View, id: string): { w: number; h: number } | null {
  const m = view.measured?.(id);
  return m && m.w > 0 && m.h > 0 ? m : null;
}

/** Guaranteed non-zero size; null only when the view doesn't hold the node. Tiers:
 *  RF's measure → live rendered size → the ResizeObserver's stored size → a default,
 *  with the fallback tiers COLLAPSE-AWARE. `editor` supplies the stored-size tier. */
export function measuredBox(view: View, id: string, editor?: Editor): NodeBox | null {
  const pos = view.position(id);
  if (!pos) return null;
  const m = measuredSize(view, id);
  if (m) return { x: pos.x, y: pos.y, w: m.w, h: m.h };
  const el = view.nodeElement(id);
  const liveW = el?.offsetWidth || 0;
  const liveH = el?.offsetHeight || 0;
  // Once painted the live DOM is the truth and already includes the collapse state.
  if (liveW > 0 && liveH > 0) return { x: pos.x, y: pos.y, w: liveW, h: liveH };

  const node = editor?.getNode(id) as { width?: number; height?: number } | undefined;
  const w = liveW || node?.width || FALLBACK_NODE_W;
  const h = collapseStore.get(id)
    ? COLLAPSED_NODE_H
    : (liveH || node?.height || FALLBACK_NODE_H);
  return { x: pos.x, y: pos.y, w, h };
}
