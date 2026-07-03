// Focus-set derivation for Isolate (see isolateStore for the store + chain BFS).
// Two entry points off the current selection:
//  - isolateSelection: the selection itself, plus any selected group's members
//    and the docked FCs of focused nodes (so an isolated node keeps its badge).
//  - isolateChain: the transitive up/downstream closure over the cables.

import { getEditor, downstreamClosure } from "./process";
import { GroupNode, FormatControllerNode } from "./rete-nodes";
import type { SolenoidNode } from "./schemes";
import { chainClosure, isolateStore } from "./isolateStore";

type AnyEditor = NonNullable<ReturnType<typeof getEditor>>;

function selectedIds(editor: AnyEditor): Set<string> {
  return new Set(
    editor.getNodes()
      .filter((n) => (n as { selected?: boolean }).selected)
      .map((n) => n.id),
  );
}

// Pull a focus set up to "whole entities": a selected group brings its members,
// and any node in the set brings the FCs docked to it.
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
  const editor = getEditor();
  if (!editor) return false;
  const seed = new Set(ids);
  if (seed.size === 0) return false;
  isolateStore.set(expandEntities(editor, seed));
  return true;
}

/** Isolate the connected chain through an explicit set (up- and downstream). */
export function isolateChainOf(ids: Iterable<string>): boolean {
  const editor = getEditor();
  if (!editor) return false;
  const seed0 = new Set(ids);
  if (seed0.size === 0) return false;
  // Seed with members so a selected group's cables are walked, then close over
  // the connection list, then re-expand for any group/FC reached along the way.
  const seed = expandEntities(editor, seed0);
  const edges = editor.getConnections().map((c) => ({ source: c.source, target: c.target }));
  isolateStore.set(expandEntities(editor, chainClosure(edges, seed)));
  return true;
}

/** Where-used: isolate the DOWNSTREAM stream from one node — "everything this
 *  value eventually feeds" (right-click → Where used). One-directional, unlike
 *  Isolate chain (which walks both ways) — reuses the same downstreamClosure
 *  the targeted-recompute path walks (process.ts), fed into the existing
 *  isolate/dim visual (no new dim CSS — see isolateStore + IsolatePill). */
export function isolateWhereUsed(nodeId: string): boolean {
  const editor = getEditor();
  if (!editor) return false;
  const downstream = downstreamClosure(editor, nodeId);
  isolateStore.set(expandEntities(editor, downstream));
  return true;
}

/** Isolate the current selection (used by the hotkey). */
export function isolateSelection(): boolean {
  const editor = getEditor();
  return editor ? isolateNodes(selectedIds(editor)) : false;
}

/** Isolate the chain through the current selection (used by the hotkey). */
export function isolateChain(): boolean {
  const editor = getEditor();
  return editor ? isolateChainOf(selectedIds(editor)) : false;
}
