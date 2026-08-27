import { getEditor } from "./process";
import { downstreamClosure } from "./graphCompute";
import { getActiveEditor } from "./activeGraph";
import { GroupNode, FormatControllerNode } from "./rete-nodes";
import type { SolenoidNode } from "./schemes";
import { chainClosure, isolateStore } from "./isolateStore";

// Isolate resolves through the ACTIVE editor, so it works inside a drill-in too.
type AnyEditor = NonNullable<ReturnType<typeof getEditor>>;

function selectedIds(editor: AnyEditor): Set<string> {
  return new Set(
    editor.getNodes()
      .filter((n) => (n as { selected?: boolean }).selected)
      .map((n) => n.id),
  );
}

// Whole entities: a group brings its members, a node brings its docked FCs.
function expandEntities(editor: AnyEditor, ids: Set<string>): Set<string> {
  const out = new Set(ids);
  for (const id of [...out]) {
    const n = editor.getNode(id) as SolenoidNode | undefined;
    if (n instanceof GroupNode) for (const m of n.members) out.add(m);
  }
  for (const n of editor.getNodes()) {
    const host = (n as { hostNodeId?: string }).hostNodeId;
    if (n instanceof FormatControllerNode && host && out.has(host)) out.add(n.id);
  }
  return out;
}

/** Isolate an explicit set of nodes (expanded to whole entities). */
export function isolateNodes(ids: Iterable<string>): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const seed = new Set(ids);
  if (seed.size === 0) return false;
  isolateStore.set(expandEntities(editor, seed));
  return true;
}

/** Isolate the connected chain through an explicit set (up- and downstream). */
export function isolateChainOf(ids: Iterable<string>): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const seed0 = new Set(ids);
  if (seed0.size === 0) return false;
  // Seed with members so a group's cables are walked, then re-expand for anything
  // reached along the way.
  const seed = expandEntities(editor, seed0);
  const edges = editor.getConnections().map((c) => ({ source: c.source, target: c.target }));
  isolateStore.set(expandEntities(editor, chainClosure(edges, seed)));
  return true;
}

/** Where-used: isolate the DOWNSTREAM stream from one node. One-directional,
 *  unlike Isolate chain (which walks both ways). */
export function isolateWhereUsed(nodeId: string): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const downstream = downstreamClosure(editor, nodeId);
  // The dim visual is identical to Isolate chain, so the label is the only thing
  // distinguishing the downstream-only set.
  isolateStore.set(expandEntities(editor, downstream), "Where used");
  return true;
}

/** Isolate the current selection (used by the hotkey). */
export function isolateSelection(): boolean {
  const editor = getActiveEditor();
  return editor ? isolateNodes(selectedIds(editor)) : false;
}

/** Isolate the chain through the current selection (used by the hotkey). */
export function isolateChain(): boolean {
  const editor = getActiveEditor();
  return editor ? isolateChainOf(selectedIds(editor)) : false;
}
