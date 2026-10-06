// [[A1]] visualGraphCalculator (module-singleton store, storeKit)

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const _values = new Map<string, Map<string, unknown>>();
const { notify, subscribe, version } = createNotifier();

export const cableValueStore = {
  setNodeOutputs(nodeId: string, outputs: Record<string, unknown>) {
    let outs = _values.get(nodeId);
    if (!outs) { outs = new Map(); _values.set(nodeId, outs); }
    for (const [k, v] of Object.entries(outputs)) outs.set(k, v);
  },

  get(nodeId: string, outputKey: string): unknown {
    return _values.get(nodeId)?.get(outputKey);
  },

  forget(nodeId: string) {
    _values.delete(nodeId);
  },

  bump: notify,

  subscribe,

  version,
};

registerNodeForget(cableValueStore.forget);
registerNodeForgetAll(() => { _values.clear(); notify(); });
