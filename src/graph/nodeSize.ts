// The ONE way to ask "how big is this node?". Every layout feature (align,
// distribute, Tidy, group autofit, standoffs, minimap, new-node placement) needs a
// node's box, and each used to re-derive it with its own `element.offsetWidth ||
// node.width || <some constant>` — with the constant inconsistent across sites
// (100×50 here, 180×160 there, 0/no-fallback elsewhere). That mismatch is the shared
// root cause behind align/distribute misplacing nodes, Tidy needing rAF band-aids,
// group autofit collapsing, and hand-authored seeds overlapping: a node reads size 0
// (or a stale design-time guess) whenever its card hasn't painted yet.
//
// measuredBox() collapses that to one rule with a GUARANTEED non-zero result:
//   1. live rendered size (element.offsetWidth/Height) — the truth once painted,
//   2. else the size the ResizeObserver last wrote to the node (node.width/height),
//   3. else a single documented default (an unpainted, never-measured node).
// Prefer this over reading offsetWidth directly anywhere layout math depends on it.

import { collapseStore } from "./collapseStore";
import type { Schemes, AreaExtra } from "./schemes";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;

export type NodeBox = { x: number; y: number; w: number; h: number };

// A node that has never painted AND never been measured. Sized to a typical small
// card so it reserves plausible space rather than 0 (which collapses bounding boxes)
// or a wild over-estimate. Kept as the single fallback so every feature agrees.
export const FALLBACK_NODE_W = 180;
export const FALLBACK_NODE_H = 100;
// Approx height of a COLLAPSED card (header + result box). Used only when an unpainted
// node is collapsed — its stored height is likely the taller expanded value, which
// would over-reserve vertical space. A painted node reports its true collapsed height
// via offsetHeight, so this constant never applies to what's on screen.
export const COLLAPSED_NODE_H = 52;

/** The node's position + a guaranteed non-zero size. Returns null only if the node
 *  has no area view at all (not on the canvas).
 *
 *  Tiers: live rendered size (the truth once painted — already reflects collapse) →
 *  the size the ResizeObserver last stored on the node → a single default. The
 *  fallback tiers are COLLAPSE-AWARE: a collapsed-but-unpainted node uses the compact
 *  collapsed height, not its stored/expanded one. `editor` supplies the stored-size
 *  fallback; pass it when available (some call sites only have the area). */
export function measuredBox(area: Area, id: string, editor?: Editor): NodeBox | null {
  const v = area.nodeViews.get(id);
  if (!v) return null;
  const liveW = v.element?.offsetWidth || 0;
  const liveH = v.element?.offsetHeight || 0;
  // Painted: live DOM is the truth and already includes the collapse state.
  if (liveW > 0 && liveH > 0) return { x: v.position.x, y: v.position.y, w: liveW, h: liveH };

  const node = editor?.getNode(id) as { width?: number; height?: number } | undefined;
  const w = liveW || node?.width || FALLBACK_NODE_W;
  const h = collapseStore.get(id)
    ? COLLAPSED_NODE_H
    : (liveH || node?.height || FALLBACK_NODE_H);
  return { x: v.position.x, y: v.position.y, w, h };
}
