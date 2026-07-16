import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { HistoryPlugin } from "rete-history-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { getEditor, getArea, getHistoryPlugin } from "./process";

// ─── Active graph (the ACTION layer's target) — THE canvas-substitution seam ────
// The graph the app CHROME acts on — keyboard shortcuts, copy/paste, right-click
// menus, the command palette, tidy, selection, zoom/fit/lock, minimap. It defaults
// to the MAIN graph; while a Composite drill-in is open its CURRENT level registers
// here, so those actions operate on the subgraph and the drill-in feels first-class.
//
// EXTENSION POINT — this is the general seam for ANY surface that "steals the
// canvas" (a composite drill-in today; a future focus/scratch surface tomorrow):
//   1. On mount, register your surface:   setActiveGraph({ editor, area, history }).
//   2. On unmount, clear it:              setActiveGraph(null).
//   3. Read the active surface in chrome: getActive*/getOwningEditor (NOT getEditor).
// The chrome then follows your surface with no further wiring. NESTED surfaces work
// without a stack because the model is REPLACE-not-pile-up: drilling deeper unmounts
// the current level (→ its cleanup) and mounts the deeper one (→ it re-registers);
// the breadcrumb STACK lives in compositeEditorStore, and this holds only "the
// current surface". If a future feature ever stacks two live surfaces at once, THAT
// is when to grow `_override` into a push/pop stack — not before.
//
// CRITICAL INVARIANT: this is deliberately NOT `getEditor()/getArea()`. Those stay
// MAIN-only forever, because persistence/autosave/serialize (`buildRawSavedGraph`)
// read them — routing them through the override would autosave the substituted
// surface OVER the document. Only the getActive* accessors below resolve through the
// override. Data/compute keeps calling `getEditor()/getArea()` (the recompute
// retarget through `findCompositeOwner` already invalidates the owning card).
// Locked by activeGraph.test.ts.

export interface ActiveGraph {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, AreaExtra>;
  history: HistoryPlugin<Schemes> | null;
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

/**
 * The editor that OWNS `nodeId` — the drill-in's internal editor when it holds the
 * node, else main. Render-time cross-node resolvers (value-box FC annotation,
 * type-default display, unit flow) walk the graph keyed by the rendered node's own
 * id; keyed on `getEditor()` (main) they silently return nothing for a node living
 * inside a Composite drill-in, so labels/units/formats/types don't propagate there.
 * Routing those reads through the OWNING editor makes the drill-in first-class
 * WITHOUT touching persistence (which never resolves by a specific node's owner —
 * it serializes `getEditor()` wholesale, and this never returns the override for a
 * main node). Cheap: one `getNode` probe, only when a subgraph is open.
 */
export function getOwningEditor(nodeId: string): NodeEditor<Schemes> | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.editor;
  return getEditor();
}

export function getActiveArea(): AreaPlugin<Schemes, AreaExtra> | null {
  return _override?.area ?? getArea();
}

/**
 * The area that OWNS `nodeId` — getOwningEditor's area twin. For code that runs for
 * EVERY rendered node regardless of surface (NodeCard's resize/collapse `area.update`,
 * a connection's z-index holder, a Conduit's lane count), keyed on the rendered
 * node's own id: `getArea()` (main) silently no-ops for a node living inside an open
 * drill-in, and `getActiveArea()` would wrongly return the drill-in for a MAIN node
 * re-rendering behind it. Same resolution rule as getOwningEditor.
 */
export function getOwningArea(nodeId: string): AreaPlugin<Schemes, AreaExtra> | null {
  if (_override && _override.editor.getNode(nodeId)) return _override.area;
  return getArea();
}

export function getActiveHistory(): HistoryPlugin<Schemes> | null {
  return _override ? _override.history : getHistoryPlugin();
}
