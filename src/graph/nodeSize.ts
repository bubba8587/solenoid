// [[D64]] oneSizeRead

import type { View } from "./view";
import { collapseStore } from "./collapseStore";
import type { Schemes } from "./schemes";
import type { NodeEditor } from "rete";

type Editor = NodeEditor<Schemes>;

export type NodeBox = { x: number; y: number; w: number; h: number };

export const FALLBACK_NODE_W = 180;
export const FALLBACK_NODE_H = 100;
export const COLLAPSED_NODE_H = 52;

export function measuredSize(view: View, id: string): { w: number; h: number } | null {
  const m = view.measured?.(id);
  return m && m.w > 0 && m.h > 0 ? m : null;
}

export function measuredBox(view: View, id: string, editor?: Editor): NodeBox | null {
  const pos = view.position(id);
  if (!pos) return null;
  const m = measuredSize(view, id);
  if (m) return { x: pos.x, y: pos.y, w: m.w, h: m.h };
  const el = view.nodeElement(id);
  const liveW = el?.offsetWidth || 0;
  const liveH = el?.offsetHeight || 0;
  if (liveW > 0 && liveH > 0) return { x: pos.x, y: pos.y, w: liveW, h: liveH };

  const node = editor?.getNode(id) as { width?: number; height?: number } | undefined;
  const w = liveW || node?.width || FALLBACK_NODE_W;
  const h = collapseStore.get(id)
    ? COLLAPSED_NODE_H
    : (liveH || node?.height || FALLBACK_NODE_H);
  return { x: pos.x, y: pos.y, w, h };
}
