// [[C52]] visibleSelection
import { getEditor } from "./process";
import { downstreamClosure } from "./graphCompute";
import { getActiveEditor } from "./activeGraph";
import { GroupNode, FormatControllerNode } from "./rete-nodes";
import type { SolenoidNode } from "./schemes";
import { chainClosure, isolateStore } from "./isolateStore";
import { unselectAllNodes, selectNode } from "./canvasCommands";

type AnyEditor = NonNullable<ReturnType<typeof getEditor>>;

function selectedIds(editor: AnyEditor): Set<string> {
  return new Set(
    editor.getNodes()
      .filter((n) => (n as { selected?: boolean }).selected)
      .map((n) => n.id),
  );
}

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

/** Receded cards leave the selection, so no verb acts on a card the user can't see. */
function enter(editor: AnyEditor, focus: Set<string>, mode?: string): void {
  isolateStore.set(focus, mode);
  const selected = [...selectedIds(editor)];
  if (selected.every((id) => focus.has(id))) return;
  unselectAllNodes();
  selected.filter((id) => focus.has(id)).forEach((id, i) => selectNode(id, i > 0));
}

export function isolateNodes(ids: Iterable<string>): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const seed = new Set(ids);
  if (seed.size === 0) return false;
  enter(editor, expandEntities(editor, seed));
  return true;
}

export function isolateChainOf(ids: Iterable<string>): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const seed0 = new Set(ids);
  if (seed0.size === 0) return false;
  const seed = expandEntities(editor, seed0);
  const edges = editor.getConnections().map((c) => ({ source: c.source, target: c.target }));
  enter(editor, expandEntities(editor, chainClosure(edges, seed)));
  return true;
}

export function isolateWhereUsed(nodeId: string): boolean {
  const editor = getActiveEditor();
  if (!editor) return false;
  const downstream = downstreamClosure(editor, nodeId);
  enter(editor, expandEntities(editor, downstream), "Where used");
  return true;
}

export function isolateSelection(): boolean {
  const editor = getActiveEditor();
  return editor ? isolateNodes(selectedIds(editor)) : false;
}

export function isolateChain(): boolean {
  const editor = getActiveEditor();
  return editor ? isolateChainOf(selectedIds(editor)) : false;
}
