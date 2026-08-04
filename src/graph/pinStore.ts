// Pinned value chips: a screen-fixed HUD of a few nodes' live values, readable
// while you pan/zoom or isolate elsewhere. We pin the VALUE (label + live output
// read from cableValueStore), NOT the rete node view — re-parenting a live node
// element would break socket measurement and drag handling.
//
// Persisted additively in SavedGraph (like standoffs). One pin per node.

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

  /** Drop a node's pin (also the noderemoved cleanup — see registration below). */
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

/** Pin (or unpin) a node's primary output value to the HUD. The one place that
 *  resolves a node id → (nodeId, outputKey): shared by the node right-click menu
 *  (Canvas) and the value popups' Pin button. A group has no single output — it
 *  pins with an empty key, and the chip shows the group's readouts instead. Tests
 *  the constructor NAME (not `instanceof`) so a Vite hot-swap of the class doesn't
 *  silently stop matching live node instances. */
export function pinNodeValue(nodeId: string): void {
  const node = getEditor()?.getNode(nodeId);
  if (!node) return;
  if (node.constructor.name === "GroupNode") { pinStore.toggle(nodeId, ""); return; }
  const outputKey = Object.keys((node as { outputs?: Record<string, unknown> }).outputs ?? {})[0];
  if (outputKey) pinStore.toggle(nodeId, outputKey);
}

// A deleted node drops its pin — same lifecycle convention as the other
// node-keyed stores (nodeStoreRegistry).
registerNodeForget((nodeId) => pinStore.remove(nodeId));
registerNodeForgetAll(() => pinStore.clear());
