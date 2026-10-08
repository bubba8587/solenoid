// [[A1]] visualGraphCalculator (module-singleton store, storeKit)

import { createNotifier } from "./storeKit";

// Transient: an input socket's cable end, in flow coordinates, while an animation carries the socket (a CardSection's
// liquid fold, SocketGoo). Set every frame and cleared when the animation ends, so it never outlives one; the cable
// edge reads it in place of its socket's measured position. Notifies at frame rate, like the drawn-cable cursor.
const _ends = new Map<string, number>();
const { notify, subscribe } = createNotifier();
const keyOf = (nodeId: string, socketKey: string) => `${nodeId}\u0000${socketKey}`;

export const cableEndMotion = {
  getY: (nodeId: string, socketKey: string): number | undefined => _ends.get(keyOf(nodeId, socketKey)),
  /** One frame's ends for one node, one notify. */
  setYs(nodeId: string, ys: ReadonlyArray<readonly [socketKey: string, y: number]>) {
    for (const [k, y] of ys) _ends.set(keyOf(nodeId, k), y);
    notify();
  },
  clear(nodeId: string, socketKeys: readonly string[]) {
    let changed = false;
    for (const k of socketKeys) changed = _ends.delete(keyOf(nodeId, k)) || changed;
    if (changed) notify();
  },
  subscribe,
};
