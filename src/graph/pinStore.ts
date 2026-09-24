// [[B10]] reactFlowView (module-singleton store, storeKit)

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

import { getOwningEditor } from "./activeGraph";

export interface Pin {
  nodeId: string;
  outputKey: string;
}

let _pins: Pin[] = [];
const { notify, subscribe, version } = createNotifier();

export const pinStore = {
  list: (): readonly Pin[] => _pins,
  has: (nodeId: string): boolean => _pins.some((p) => p.nodeId === nodeId),

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

  serialize: (): Pin[] => _pins.map((p) => ({ ...p })),

  /** Adds loaded pins; a node already pinned keeps its pin. */
  merge(pins: Pin[]): void {
    const next = [..._pins];
    for (const p of pins) if (!next.some((q) => q.nodeId === p.nodeId)) next.push({ ...p });
    if (next.length === _pins.length) return;
    _pins = next;
    notify();
  },

  subscribe,
  version,
};

export function pinNodeValue(nodeId: string): void {
  const node = getOwningEditor(nodeId)?.getNode(nodeId);
  if (!node) return;
  if (node.constructor.name === "GroupNode") { pinStore.toggle(nodeId, ""); return; }
  const outputKey = Object.keys((node as { outputs?: Record<string, unknown> }).outputs ?? {})[0];
  if (outputKey) pinStore.toggle(nodeId, outputKey);
}

registerNodeForget((nodeId) => pinStore.remove(nodeId));
registerNodeForgetAll(() => pinStore.clear());
