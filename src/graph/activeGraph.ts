// [[C33]] saveBindsMain
import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { getEditor, getView } from "./process";
// Chrome acts on this graph; getEditor()/getView() stay main-only, or autosave would save a substituted surface.

export interface ActiveGraph {
  editor: NodeEditor<Schemes>;
  view: View;
}

let _override: ActiveGraph | null = null;
const listeners = new Set<() => void>();

const owned = new Set<ActiveGraph>();

export function registerOwnedGraph(ctx: ActiveGraph): () => void {
  owned.add(ctx);
  return () => { owned.delete(ctx); };
}

export function setActiveGraph(ctx: ActiveGraph | null): void {
  if (_override === ctx) return;
  _override = ctx;
  for (const l of listeners) l();
}

export function subscribeActiveGraph(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isSubgraphActive(): boolean {
  return _override !== null;
}

export function getActiveEditor(): NodeEditor<Schemes> | null {
  return _override?.editor ?? getEditor();
}

/** Render-time resolvers key on this: `getEditor()` finds nothing for a node in a drill-in or a locked scene canvas. */
export function getOwningEditor(nodeId: string): NodeEditor<Schemes> | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.editor;
  const main = getEditor();
  if (main?.getNode(nodeId)) return main;
  for (const g of owned) if (g.editor.getNode(nodeId)) return g.editor;
  return (main && closedSubgraphOf(main, nodeId)) ?? main;
}

type Subgraphed = { internalEditor?: NodeEditor<Schemes> };

/** A node inside a composite that isn't open: its editor is only reachable through the composite, at any depth. */
function closedSubgraphOf(editor: NodeEditor<Schemes>, nodeId: string, depth = 0): NodeEditor<Schemes> | null {
  if (depth > 16) return null;
  for (const n of editor.getNodes()) {
    const inner = (n as Subgraphed).internalEditor;
    if (!inner) continue;
    if (inner.getNode(nodeId)) return inner;
    const deeper = closedSubgraphOf(inner, nodeId, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}

export function getActiveView(): View | null {
  return _override?.view ?? getView();
}

/** `getView()` no-ops in a drill-in, and `getActiveView()` wrongly returns the drill-in for a main node. */
export function getOwningView(nodeId: string): View | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.view;
  const main = getEditor();
  if (main?.getNode(nodeId)) return getView();
  for (const g of owned) if (g.editor.getNode(nodeId)) return g.view;
  return getView();
}
