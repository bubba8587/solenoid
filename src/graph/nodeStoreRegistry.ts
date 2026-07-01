// One place that answers "what happens to a node-keyed store entry when its node
// is deleted?". Rete renders nodes in a separate React root, so per-node UI state
// (collapse, manual size, live cable values, socket exit angles) lives in
// module-level stores keyed by node id rather than React state. Each such store
// registers a `forget(nodeId)` here; the single `noderemoved` handler calls
// `forgetNode(id)`, so a deleted node's entries don't linger until the next full
// reload.
//
// The convention: a NEW node-keyed store adds ONE `registerNodeForget(...)` call
// at module scope and is done — it never has to remember to thread cleanup into
// Canvas.tsx. (Before this, each store re-answered the question ad hoc, and most
// answered it by leaking; collapse-state answered it wrong.)

type Forgetter = (nodeId: string) => void;

const _forgetters = new Set<Forgetter>();
const _forgetAllers = new Set<() => void>();

/** Register a store's per-node cleanup. Idempotent for the same function. */
export function registerNodeForget(fn: Forgetter): void {
  _forgetters.add(fn);
}

/** Register a store's bulk reset (drop ALL node entries at once). A wholesale
 *  rebuild (load / clear) uses this instead of N per-node `forget` calls — some
 *  stores scan their whole map per `forget`, so per-node cleanup over a big
 *  graph is O(nodes × entries). A store that registers a forgetter should also
 *  register this so `forgetAllNodes()` is a complete reset. */
export function registerNodeForgetAll(fn: () => void): void {
  _forgetAllers.add(fn);
}

/** Drop every registered store's entries for one node id (called on noderemoved). */
export function forgetNode(nodeId: string): void {
  for (const fn of _forgetters) fn(nodeId);
}

/** Bulk-reset every registered node-keyed store in one pass (called by
 *  rebuildGraph). O(total entries) once instead of O(nodes × entries). */
export function forgetAllNodes(): void {
  for (const fn of _forgetAllers) fn();
}
