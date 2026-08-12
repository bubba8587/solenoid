// Cleanup for node-keyed module stores: a new store adds ONE module-scope
// `registerNodeForget(...)` call and never threads cleanup into Canvas.tsx.

type Forgetter = (nodeId: string) => void;

const _forgetters = new Set<Forgetter>();
const _forgetAllers = new Set<() => void>();

/** Register a store's per-node cleanup. Idempotent for the same function. */
export function registerNodeForget(fn: Forgetter): void {
  _forgetters.add(fn);
}

/** Register a store's bulk reset; a store with a forgetter should register this too,
 *  or `forgetAllNodes()` is incomplete and a rebuild costs O(nodes × entries). */
export function registerNodeForgetAll(fn: () => void): void {
  _forgetAllers.add(fn);
}

/** Drop every registered store's entries for one node id (called on noderemoved). */
export function forgetNode(nodeId: string): void {
  for (const fn of _forgetters) fn(nodeId);
}

/** Bulk-reset every registered node-keyed store in one pass (called by rebuildGraph). */
export function forgetAllNodes(): void {
  for (const fn of _forgetAllers) fn();
}
