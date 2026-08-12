// Per-socket cable exit angles for non-cardinal sockets (a rotated Conduit).
// Degrees CW from +X (0 = right, 90 = down); absent = cardinal Right/Left.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

const _angles = new Map<string, number>();
const { notify, subscribe } = createNotifier();

const key = (nodeId: string, socketKey: string) => `${nodeId}::${socketKey}`;

export const cableAngleStore = {
  set(nodeId: string, socketKey: string, angleDeg: number) {
    const k = key(nodeId, socketKey);
    if (_angles.get(k) === angleDeg) return;
    _angles.set(k, angleDeg);
    notify();
  },
  clear(nodeId: string, socketKey: string) {
    const k = key(nodeId, socketKey);
    if (!_angles.has(k)) return;
    _angles.delete(k);
    notify();
  },
  get(nodeId: string, socketKey: string): number | null {
    return _angles.get(key(nodeId, socketKey)) ?? null;
  },
  forget(nodeId: string) {
    const prefix = `${nodeId}::`;
    let changed = false;
    for (const k of _angles.keys()) {
      if (k.startsWith(prefix)) { _angles.delete(k); changed = true; }
    }
    if (changed) notify();
  },
  subscribe,
};

registerNodeForget(cableAngleStore.forget);
registerNodeForgetAll(() => { _angles.clear(); notify(); });
