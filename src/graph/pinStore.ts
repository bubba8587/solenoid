// A pin holds the VALUE, never the rete node view — re-parenting a live node element
// would break socket measurement and drag handling. One pin per node.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { getEditor } from "./process";

export interface Pin {
  nodeId: string;
  outputKey: string; // which output's value to show (the node's primary one)
}

let _pins: Pin[] = [];
const { notify, subscribe, version } = createNotifier();

export const pinStore = {
  list: (): readonly Pin[] => _pins,
  has: (nodeId: string): boolean => _pins.some((p) => p.nodeId === nodeId),

  /** Pin a node's value, or unpin it if already pinned. */
  toggle(nodeId: string, outputKey: string): void {
    _pins = _pins.some((p) => p.nodeId === nodeId)
      ? _pins.filter((p) => p.nodeId !== nodeId)
      : [..._pins, { nodeId, outputKey }];
    notify();
  },

  remove(nodeId: string): void {
    const next = _pins.filter((p) => p.nodeId !== nodeId);
    if (next.length !== _pins.length) { _pins = next; notify(); }
  },

  clear(): void {
    if (_pins.length > 0) { _pins = []; notify(); }
  },

  /** Serialize for SavedGraph (returns plain copies). */
  serialize: (): Pin[] => _pins.map((p) => ({ ...p })),

  /** Replace the set (loadGraph, after id-remapping). */
  load(pins: Pin[]): void {
    _pins = pins.map((p) => ({ ...p }));
    notify();
  },

  subscribe,
  version,
};

/** The ONE place resolving a node id → (nodeId, outputKey); a group has no single
 *  output and pins with an empty key. Tests the constructor NAME, not `instanceof`,
 *  so a Vite hot-swap can't silently stop matching live instances. */
export function pinNodeValue(nodeId: string): void {
  const node = getEditor()?.getNode(nodeId);
  if (!node) return;
  if (node.constructor.name === "GroupNode") { pinStore.toggle(nodeId, ""); return; }
  const outputKey = Object.keys((node as { outputs?: Record<string, unknown> }).outputs ?? {})[0];
  if (outputKey) pinStore.toggle(nodeId, outputKey);
}

registerNodeForget((nodeId) => pinStore.remove(nodeId));
registerNodeForgetAll(() => pinStore.clear());
