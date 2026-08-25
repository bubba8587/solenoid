import { Presets as HistoryPresets } from "rete-history-plugin";
import { nodeDisplayName } from "./catalogUtils";

// Pure human-readable log from rete-history-plugin's raw records. Its action fields are
// TypeScript-`private` only (not runtime), so they're cast-read; a missing one degrades
// to a generic phrase instead of throwing.
const { AddNodeAction, RemoveNodeAction, DragNodeAction, AddConnectionAction, RemoveConnectionAction } = HistoryPresets.classic;

export interface HistoryDigestRecord {
  time: number;
  action: unknown;
}

export interface DigestLookup {
  /** Current display name for a still-live node, or undefined if it's gone. */
  nodeName(id: string): string | undefined;
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function nodeRef(lookup: DigestLookup, id: string | undefined): string {
  if (!id) return "a node";
  return lookup.nodeName(id) ?? "a node (removed)";
}

interface ConnLike {
  source?: string;
  sourceOutput?: string;
  target?: string;
  targetInput?: string;
}

/** Reach the private `connection` field both connection actions carry. */
function connOf(action: object): ConnLike | undefined {
  return (action as { connection?: ConnLike }).connection;
}

function connLine(verb: string, action: object, lookup: DigestLookup): string {
  const c = connOf(action);
  if (!c) return `${verb} a connection`;
  return `${verb} ${nodeRef(lookup, c.source)} → ${nodeRef(lookup, c.target)}`;
}

/** One human-readable line for a single history action (no timestamp prefix). */
export function describeAction(action: unknown, lookup: DigestLookup): string {
  if (action instanceof AddNodeAction) {
    const id = (action as unknown as { nodeId?: string }).nodeId;
    return `Added node: ${nodeRef(lookup, id)}`;
  }
  if (action instanceof RemoveNodeAction) {
    const node = (action as unknown as {
      node?: { label?: string; constructor: { name: string } };
    }).node;
    const name = node ? nodeDisplayName(node) : "a node";
    return `Removed node: ${name}`;
  }
  if (action instanceof DragNodeAction) {
    return `Moved node: ${nodeRef(lookup, action.nodeId)}`;
  }
  if (action instanceof AddConnectionAction) return connLine("Connected", action, lookup);
  if (action instanceof RemoveConnectionAction) return connLine("Disconnected", action, lookup);
  return "Other action";
}

/** One line per record under a date header; records can span days, since
 *  rete-history-plugin clears only on document load. */
export function digestHistory(records: HistoryDigestRecord[], lookup: DigestLookup): string {
  if (records.length === 0) return "No actions yet this session.";
  const lines: string[] = [];
  let lastDate = "";
  for (const r of records) {
    const d = fmtDate(r.time);
    if (d !== lastDate) {
      lines.push(`— ${d} —`);
      lastDate = d;
    }
    lines.push(`${fmtTime(r.time)}  ${describeAction(r.action, lookup)}`);
  }
  return lines.join("\n");
}
