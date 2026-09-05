// React Flow port (C5) — labels for snapshot undo. rete-history-plugin carried
// typed actions to describe; a snapshot stack has only the documents, so the
// label is DERIVED by diffing consecutive snapshots.
import type { SavedGraph, SavedNode, SavedConnection } from "../persistence";

const nodeName = (n: SavedNode | undefined): string => n?.name || n?.type || "a node";

const connKey = (c: SavedConnection): string =>
  `${c.source}\u0000${c.sourceOutput}\u0000${c.target}\u0000${c.targetInput}`;

// The identity/geometry fields are judged separately; everything else counts
// as an edit. init.width/height are the card's MEASURED dims — they settle
// after the baseline snapshot and drift with content, so they never count
// (a user resize there reads as the "Edited document" fallback, cheap next to
// every record shouting "Edited 5 nodes").
function editBody(n: SavedNode): string {
  const { id: _id, name: _name, x: _x, y: _y, init, ...rest } = n;
  const { width: _w, height: _h, ...initRest } = (init ?? {}) as Record<string, unknown>;
  return JSON.stringify({ ...rest, init: initRest });
}

/** One human-readable line for what changed between two consecutive snapshots.
 *  A snapshot can carry several kinds of change at once (a paste adds nodes AND
 *  cables); the parts join into one line, most significant first. Moves are
 *  reported only when nothing else changed — they ride along with group tows
 *  and expand pushes, where they'd bury the real action. */
export function describeGraphDelta(prev: SavedGraph, next: SavedGraph): string {
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextNodes = new Map(next.nodes.map((n) => [n.id, n]));

  const added = next.nodes.filter((n) => !prevNodes.has(n.id));
  const removed = prev.nodes.filter((n) => !nextNodes.has(n.id));
  const renamed: Array<{ from: string; to: string }> = [];
  const edited: SavedNode[] = [];
  const moved: SavedNode[] = [];
  for (const n of next.nodes) {
    const p = prevNodes.get(n.id);
    if (!p) continue;
    if ((p.name ?? "") !== (n.name ?? "")) renamed.push({ from: nodeName(p), to: nodeName(n) });
    if (editBody(p) !== editBody(n)) edited.push(n);
    if (p.x !== n.x || p.y !== n.y) moved.push(n);
  }

  const nextConns = new Set(next.connections.map(connKey));
  const prevConns = new Set(prev.connections.map(connKey));
  const connAdded = next.connections.filter((c) => !prevConns.has(connKey(c)));
  const connRemoved = prev.connections.filter((c) => !nextConns.has(connKey(c)));

  const nodeList = (ns: SavedNode[], verb: string) =>
    ns.length === 1 ? `${verb} node: ${nodeName(ns[0])}` : `${verb} ${ns.length} nodes`;
  const connList = (cs: SavedConnection[], verb: string) => {
    if (cs.length !== 1) return `${verb} ${cs.length} cables`;
    const c = cs[0];
    const end = (id: string) => nodeName(nextNodes.get(id) ?? prevNodes.get(id));
    return `${verb} ${end(c.source)} → ${end(c.target)}`;
  };

  const parts: string[] = [];
  if (added.length) parts.push(nodeList(added, "Added"));
  if (removed.length) parts.push(nodeList(removed, "Removed"));
  if (connAdded.length) parts.push(connList(connAdded, "Connected"));
  if (connRemoved.length) parts.push(connList(connRemoved, "Disconnected"));
  if (renamed.length === 1) parts.push(`Renamed ${renamed[0].from} → ${renamed[0].to}`);
  else if (renamed.length > 1) parts.push(`Renamed ${renamed.length} nodes`);
  if (edited.length) parts.push(nodeList(edited, "Edited"));
  if (!parts.length && moved.length)
    parts.push(moved.length === 1 ? `Moved node: ${nodeName(moved[0])}` : `Moved ${moved.length} nodes`);
  if (!parts.length) {
    const pd = prev.drawnCables?.length ?? 0;
    const nd = next.drawnCables?.length ?? 0;
    if (JSON.stringify(prev.standoffs ?? []) !== JSON.stringify(next.standoffs ?? []))
      parts.push("Changed standoffs");
    else if (nd > pd) parts.push(nd - pd === 1 ? "Drew a cable" : `Drew ${nd - pd} cables`);
    else if (nd < pd) parts.push(pd - nd === 1 ? "Removed a drawn cable" : `Removed ${pd - nd} drawn cables`);
    else if (JSON.stringify(prev.drawnCables ?? []) !== JSON.stringify(next.drawnCables ?? []))
      parts.push("Edited a drawn cable");
    else parts.push("Edited document");
  }
  return parts.join("; ");
}
