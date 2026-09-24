// [[B12]] losslessSaves, [[C30]] saveViaTextForm, [[C77]] compositeIsSubgraph
import type { ClassicPreset } from "rete";
import { extractInit } from "./copyPaste";
import { nodeSizeStore } from "./nodeSizeStore";
import { collapseStore } from "./collapseStore";
import { socketFlipStore } from "./socketFlipStore";
import { PlaceholderNode } from "./nodes/placeholder";
import { standoffStore, type StandoffEnd } from "./standoffs";
import { pinStore, type Pin } from "./pinStore";
import { commentStore, type SavedCommentData } from "./commentStore";
import { frameFormatStore, type FrameColumnFormat } from "./frameFormatStore";

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

/** An arrangement constraint between two nodes of one canvas ([[standoffs]]). */
export interface SavedStandoff {
  a: StandoffEnd;
  b: StandoffEnd;
  min: number;
  max: number;
  locked?: boolean;
}

/** The per-node state kept outside the node list; the main save holds its own cards' entries, a composite's snapshot its inner cards'. */
export interface SideTables {
  standoffs?: SavedStandoff[];
  pins?: Pin[];
  comments?: SavedCommentData[];
  frameFormats?: FrameColumnFormat[];
}

/** The entries whose every node `owns` holds, written under saved ids. */
export function savedSideTables(owns: (liveId: string) => boolean, sid: (liveId: string) => string = (id) => id): SideTables {
  const t: SideTables = {};
  const standoffs = standoffStore.all()
    .filter((s) => owns(s.a.nodeId) && owns(s.b.nodeId))
    .map((s): SavedStandoff => ({
      a: { ...s.a, nodeId: sid(s.a.nodeId) },
      b: { ...s.b, nodeId: sid(s.b.nodeId) },
      min: Math.round(s.min),
      max: Math.round(s.max),
      ...(s.locked ? { locked: true } : {}),
    }));
  if (standoffs.length > 0) t.standoffs = standoffs;
  const pins = pinStore.serialize().filter((p) => owns(p.nodeId)).map((p) => ({ ...p, nodeId: sid(p.nodeId) }));
  if (pins.length > 0) t.pins = pins;
  const comments = commentStore.serialize().filter((c) => owns(c.nodeId)).map((c) => ({ ...c, nodeId: sid(c.nodeId) }));
  if (comments.length > 0) t.comments = comments;
  const frameFormats = frameFormatStore.serialize().filter((f) => owns(f.nodeId)).map((f) => ({ ...f, nodeId: sid(f.nodeId) }));
  if (frameFormats.length > 0) t.frameFormats = frameFormats;
  return t;
}

/** The load half, additive: `live` maps a saved id to its live node's id, or undefined when that node is gone. */
export function restoreSideTables(t: SideTables, live: (savedId: string) => string | undefined): void {
  for (const s of t.standoffs ?? []) {
    const a = live(s.a.nodeId);
    const b = live(s.b.nodeId);
    if (!a || !b || a === b) continue;
    standoffStore.add({ nodeId: a, anchor: s.a.anchor }, { nodeId: b, anchor: s.b.anchor }, s.min, s.max, s.locked ?? false);
  }
  const remap = <T extends { nodeId: string }>(list: T[] | undefined): T[] =>
    (list ?? []).flatMap((e) => {
      const nodeId = live(e.nodeId);
      return nodeId ? [{ ...e, nodeId }] : [];
    });
  pinStore.merge(remap(t.pins));
  commentStore.merge(remap(t.comments));
  frameFormatStore.merge(remap(t.frameFormats));
}
