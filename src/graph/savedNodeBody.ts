// [[B12]] losslessSaves, [[C30]] saveViaTextForm, [[C77]] compositeIsSubgraph
import type { ClassicPreset } from "rete";
import { extractInit } from "./copyPaste";
import { nodeSizeStore } from "./nodeSizeStore";
import { collapseStore } from "./collapseStore";
import { socketFlipStore } from "./socketFlipStore";
import { PlaceholderNode } from "./nodes/placeholder";

/** Everything a save keeps about one node besides its id, name and position; the main canvas and a composite's internals share it. */
export interface SavedNodeBody {
  type: string;
  init: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  size?: { w: number; h: number };
  collapsed?: boolean;
  flipped?: boolean;
}

export function savedNodeBody(n: ClassicPreset.Node): SavedNodeBody {
  const body: SavedNodeBody = n instanceof PlaceholderNode
    ? { type: n.missingType, init: { ...n.savedInit } }
    : { type: n.constructor.name, init: extractInit(n) };
  const lit = n instanceof PlaceholderNode ? n.savedLiterals : (n as unknown as { literals?: unknown }).literals;
  const str = n instanceof PlaceholderNode ? n.savedStringLiterals : (n as unknown as { stringLiterals?: unknown }).stringLiterals;
  if (lit && typeof lit === "object") body.literals = { ...(lit as Record<string, number>) };
  if (str && typeof str === "object") body.stringLiterals = { ...(str as Record<string, string>) };
  const sz = nodeSizeStore.get(n.id);
  if (sz) body.size = { w: Math.round(sz.w), h: Math.round(sz.h) };
  if (collapseStore.get(n.id)) body.collapsed = true;
  if (socketFlipStore.get(n.id)) body.flipped = true;
  return body;
}

/** The load half: the card state a saved body carries, written back onto the live node's stores. */
export function restoreNodeState(liveId: string, sn: Pick<SavedNodeBody, "size" | "collapsed" | "flipped">): void {
  if (sn.size) nodeSizeStore.set(liveId, { ...sn.size });
  if (sn.collapsed) collapseStore.set(liveId, true);
  if (sn.flipped) socketFlipStore.set(liveId, true);
}
