import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { getEditor, getView } from "./process";
// The graph the app CHROME acts on, and the seam any canvas-substituting surface registers
// with. Deliberately NOT `getEditor()/getView()`, which stay MAIN-only forever because
// persistence reads them — the override would autosave the substituted surface over the
// document. Locked by activeGraph.test.ts.

export interface ActiveGraph {
  editor: NodeEditor<Schemes>;
  view: View;
}

let _override: ActiveGraph | null = null;
const listeners = new Set<() => void>();

// OWNERSHIP-only registry, distinct from `_override`: locked auxiliary canvases (the
// landing scene cards) whose nodes live in their own editor and must resolve their
// output socket type / FC annotation at render time, but which are NEVER the action
// target — no chrome acts on them and autosave never sees them. Several can be live at
// once, so this is a set, not a single slot.
const owned = new Set<ActiveGraph>();

/** Register a locked auxiliary graph so its nodes resolve through getOwning*; returns
 *  the unregister fn (call on unmount). Does NOT change the action target. */
export function registerOwnedGraph(ctx: ActiveGraph): () => void {
  owned.add(ctx);
  return () => { owned.delete(ctx); };
}

/** Register the drill-in's current level as the action target (null = back to main). */
export function setActiveGraph(ctx: ActiveGraph | null): void {
  if (_override === ctx) return;
  _override = ctx;
  for (const l of listeners) l();
}

/** Subscribe to active-graph changes (React chrome that must re-render on drill). */
export function subscribeActiveGraph(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** True while a subgraph (composite drill-in) is the active action target. */
export function isSubgraphActive(): boolean {
  return _override !== null;
}

export function getActiveEditor(): NodeEditor<Schemes> | null {
  return _override?.editor ?? getEditor();
}

/** The editor that OWNS `nodeId`. Render-time cross-node resolvers must key on this, not
 *  `getEditor()`, which silently returns nothing for a node inside a drill-in — or in a
 *  locked scene canvas (checked after main, so a main node always resolves to main). */
export function getOwningEditor(nodeId: string): NodeEditor<Schemes> | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.editor;
  const main = getEditor();
  if (main?.getNode(nodeId)) return main;
  for (const g of owned) if (g.editor.getNode(nodeId)) return g.editor;
  return main;
}

export function getActiveView(): View | null {
  return _override?.view ?? getView();
}

/** getOwningEditor's view twin, for code running per rendered node: `getView()` no-ops
 *  inside a drill-in, and `getActiveView()` wrongly returns the drill-in for a MAIN node. */
export function getOwningView(nodeId: string): View | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.view;
  const main = getEditor();
  if (main?.getNode(nodeId)) return getView();
  for (const g of owned) if (g.editor.getNode(nodeId)) return g.view;
  return getView();
}
