import type { Area } from "./area";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { getEditor, getArea } from "./process";
// The graph the app CHROME acts on, and the seam any canvas-substituting surface registers
// with. Deliberately NOT `getEditor()/getArea()`, which stay MAIN-only forever because
// persistence reads them — the override would autosave the substituted surface over the
// document. Locked by activeGraph.test.ts.

export interface ActiveGraph {
  editor: NodeEditor<Schemes>;
  area: Area;
}

let _override: ActiveGraph | null = null;
const listeners = new Set<() => void>();

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
 *  `getEditor()`, which silently returns nothing for a node inside a drill-in. */
export function getOwningEditor(nodeId: string): NodeEditor<Schemes> | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.editor;
  return getEditor();
}

export function getActiveArea(): Area | null {
  return _override?.area ?? getArea();
}

/** getOwningEditor's area twin, for code running per rendered node: `getArea()` no-ops
 *  inside a drill-in, and `getActiveArea()` wrongly returns the drill-in for a MAIN node. */
export function getOwningArea(nodeId: string): Area | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.area;
  return getArea();
}

