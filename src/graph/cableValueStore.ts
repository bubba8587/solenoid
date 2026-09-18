// [[B10]] reactFlowView (module-singleton store, storeKit), [[C40]] storesRegisterForget
// The most-recent value per node output, keyed `${nodeId}:${outputKey}` (a COMBO
// socket's cable color, the fallback card's preview, group readouts).

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const _values = new Map<string, unknown>();
const { notify, subscribe, version } = createNotifier();

export const cableValueStore = {
  setNodeOutputs(nodeId: string, outputs: Record<string, unknown>) {
    for (const [k, v] of Object.entries(outputs)) {
      _values.set(`${nodeId}:${k}`, v);
    }
  },

  get(nodeId: string, outputKey: string): unknown {
    return _values.get(`${nodeId}:${outputKey}`);
  },

  /** The colon in the key makes the node-id prefix unambiguous. */
  forget(nodeId: string) {
    const prefix = `${nodeId}:`;
    for (const k of _values.keys()) {
      if (k.startsWith(prefix)) _values.delete(k);
    }
  },

  bump: notify,

  subscribe,

  version,
};

registerNodeForget(cableValueStore.forget);
registerNodeForgetAll(() => { _values.clear(); notify(); });
