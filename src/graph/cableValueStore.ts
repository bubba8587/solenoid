// [[A1]] visualGraphCalculator (module-singleton store, storeKit), [[C130]] rustCore, [[C120]] linearWork
// The cable readouts' values: each node output as an app pass last landed it, read from the core that ran the pass
// (graph-core.md § Direct calls) and converted only when something asks. A pass ends with `bump()`.

import { createNotifier } from "./storeKit";
import { registerNodeForgetAll } from "./nodeStoreRegistry";

/** An engine whose passes the readouts show: the main canvas's, and a landing or static stage's while it computes. */
export interface LandedSource {
  landed(nodeId: string, key: string): unknown;
}

const _sources: WeakRef<LandedSource>[] = [];
const { notify, subscribe, version } = createNotifier();

export const cableValueStore = {
  /** `engine` ran a pass: its outputs are readouts too, ahead of the engines before it. Ids are unique across
   *  editors, so a node's value is in one engine at most. */
  readFrom(engine: LandedSource) {
    const at = _sources.findIndex((r) => r.deref() === engine);
    if (at === 0) return;
    if (at > 0) _sources.splice(at, 1);
    _sources.unshift(new WeakRef(engine));
  },

  get(nodeId: string, outputKey: string): unknown {
    for (let i = 0; i < _sources.length; i++) {
      const engine = _sources[i].deref();
      if (!engine) {
        _sources.splice(i--, 1);
        continue;
      }
      const v = engine.landed(nodeId, outputKey);
      if (v !== undefined) return v;
    }
    return undefined;
  },

  bump: notify,

  subscribe,

  version,
};

registerNodeForgetAll(notify);
