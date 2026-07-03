import { Presets as HistoryPresets } from "rete-history-plugin";
import { nodeTypeName } from "./nodeNames";

// ─── Session History digest ────────────────────────────────────────────────────
// Turns rete-history-plugin's raw undo/redo record stream into a dated,
// human-readable log for the Session History node (bundle 13 #49). Pure +
// unit-tested (no editor/DOM deps) — the SessionHistoryComponent supplies the
// live records (history.getHistorySnapshot()) and a node-name lookup, both of
// which need the editor.
//
// The classic preset's action classes mark most fields TypeScript-`private` —
// compile-time only, not enforced at runtime (same as Canvas's own
// `history.history.limit` reach-around into the plugin's internals). Only
// DragNodeAction's nodeId/prev/new are genuinely public; AddNodeAction.nodeId,
// RemoveNodeAction.node, and both connection actions' `connection` need a cast to
// read. Best-effort: a field that isn't there (a future plugin version, an action
// mid-undo) degrades to a generic phrase instead of throwing.
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
    const name = node ? (node.label?.trim() || nodeTypeName(node)) : "a node";
    return `Removed node: ${name}`;
  }
  if (action instanceof DragNodeAction) {
    return `Moved node: ${nodeRef(lookup, action.nodeId)}`;
  }
  if (action instanceof AddConnectionAction) return connLine("Connected", action, lookup);
  if (action instanceof RemoveConnectionAction) return connLine("Disconnected", action, lookup);
  return "Other action";
}

/** The full digest: one line per record, grouped under a date header whenever
 *  the date changes (a session that runs past midnight, or a reopened autosave
 *  history — rete-history-plugin doesn't clear on its own, only on document load). */
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
