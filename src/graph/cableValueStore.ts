// Stores the most-recent output values for every node output, keyed by
// `${nodeId}:${outputKey}`. Populated by processGraph after each engine fetch.
// ConnectionComponent subscribes to resolve combo socket cable colors (e.g.
// numlist → actual number or list color based on the live value).

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

  /** Forget a deleted node's outputs (noderemoved → forgetNode). Keys are
   *  `${nodeId}:${outputKey}`; the colon makes the id prefix unambiguous. */
  forget(nodeId: string) {
    const prefix = `${nodeId}:`;
    for (const k of _values.keys()) {
      if (k.startsWith(prefix)) _values.delete(k);
    }
  },

  /** Re-render subscribers after a processGraph pass refreshed the values. */
  bump: notify,

  subscribe,

  version,
};

registerNodeForget(cableValueStore.forget);
registerNodeForgetAll(() => { _values.clear(); notify(); });
