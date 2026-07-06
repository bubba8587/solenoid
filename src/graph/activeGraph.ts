import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { HistoryPlugin } from "rete-history-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { getEditor, getArea, getHistoryPlugin } from "./process";

// ─── Active graph (the ACTION layer's target) ─────────────────────────────────
// The graph the app CHROME acts on — keyboard shortcuts, copy/paste, right-click
// menus, the command palette, tidy, selection. It defaults to the MAIN graph; while
// a Composite drill-in is open its CURRENT level registers here, so those actions
// operate on the subgraph and the drill-in feels first-class.
//
// CRITICAL: this is deliberately NOT `getEditor()/getArea()`. Those stay MAIN-only
// forever, because persistence/autosave/serialize (`buildRawSavedGraph`) read them —
// routing them through the override would autosave the subgraph OVER the document.
// Only the NEW getActive* accessors below resolve through the override. Data/compute
// keeps calling `getEditor()/getArea()` (the recompute retarget through
// `findCompositeOwner` already invalidates the owning composite card).

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

export function getActiveArea(): AreaPlugin<Schemes, AreaExtra> | null {
  return _override?.area ?? getArea();
}

export function getActiveHistory(): HistoryPlugin<Schemes> | null {
  return _override ? _override.history : getHistoryPlugin();
}
