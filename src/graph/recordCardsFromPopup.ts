// [[C114]] cardsView, [[B11]] maximalMerge
import { ClassicPreset } from "rete";
import { getOwningEditor, getOwningView } from "./activeGraph";
import { cableValueStore } from "./cableValueStore";
import { isFrameValue } from "./frame";
import { isFrameRef } from "./frameBackend";
import { nodeNameStore } from "./nodeNameStore";
import { processGraph } from "./process";
import { scheduleAutosave } from "./persistence";
import { flyToNodeAndFlash } from "./flyToNode";
import { RecordNode } from "./rete-nodes";
import type { SolenoidConnection } from "./schemes";
import { setRecordCardsAction } from "./tablePopupStore";

const GAP = 80;
const STEP = 40;
const NEW_W = 240;
const NEW_H = 220;

type Box = { x: number; y: number; w: number; h: number };
const hits = (a: Box, b: Box) => a.x < b.x + b.w + 20 && b.x < a.x + a.w + 20 && a.y < b.y + b.h + 20 && b.y < a.y + a.h + 20;

/** The first clear spot scanning down the column right of `from`, then the next columns over; deterministic. */
export function freeSpotRightOf(from: Box, taken: readonly Box[]): { x: number; y: number } {
  for (let col = 0; col < 12; col++) {
    const x = from.x + from.w + GAP + col * (NEW_W + GAP);
    for (let i = 0; i < 40; i++) {
      const cand = { x, y: from.y + i * STEP, w: NEW_W, h: NEW_H };
      if (!taken.some((b) => hits(cand, b))) return { x: cand.x, y: cand.y };
    }
  }
  return { x: from.x + from.w + GAP, y: from.y };
}

/** The host's output carrying the frame the popup shows: `frame` when several do, else the first; null when none does. */
export function frameOutputOf(hostId: string): string | null {
  const node = getOwningEditor(hostId)?.getNode(hostId);
  if (!node) return null;
  const keys = Object.keys(node.outputs).filter((k) => {
    const v = cableValueStore.get(hostId, k);
    return isFrameValue(v) || isFrameRef(v);
  });
  return keys.includes("frame") ? "frame" : keys[0] ?? null;
}

/** Places a Record node in the Cards view right of the host, wired to its frame output, and flies to it. */
export async function addRecordCards(hostId: string): Promise<string | null> {
  const editor = getOwningEditor(hostId);
  const view = getOwningView(hostId);
  const host = editor?.getNode(hostId);
  const out = frameOutputOf(hostId);
  if (!editor || !view || !host || !out) return null;
  const rec = new RecordNode({ op: "cards", label: "Cards" });
  await editor.addNode(rec as never);
  nodeNameStore.ensure(rec.id, rec.constructor.name);
  const boxOf = (id: string): Box | null => {
    const at = view.position(id);
    const n = editor.getNode(id) as { width?: number; height?: number } | undefined;
    return at && n ? { x: at.x, y: at.y, w: n.width ?? 240, h: n.height ?? 160 } : null;
  };
  const from = boxOf(hostId) ?? { x: 0, y: 0, w: 240, h: 160 };
  const taken = editor.getNodes().flatMap((n) => (n.id === rec.id ? [] : [boxOf(n.id)].filter((b): b is Box => b !== null)));
  await view.moveNode(rec.id, freeSpotRightOf(from, taken));
  await editor.addConnection(new ClassicPreset.Connection(host, out, rec, "frame") as unknown as SolenoidConnection);
  scheduleAutosave();
  await processGraph(rec.id);
  flyToNodeAndFlash(rec.id);
  return rec.id;
}

/** The app's startup hook; returns the uninstall, as `installExternalLinkGuard` does. */
export function installRecordCardsAction(): () => void {
  setRecordCardsAction({ canAdd: (hostId) => frameOutputOf(hostId) !== null, add: addRecordCards });
  return () => setRecordCardsAction(null);
}
