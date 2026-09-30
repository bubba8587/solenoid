// [[B10]] reactFlowView (module-singleton store, storeKit)
// The sockets each card shows right now, wired or not. A card declares every socket it can have, but several show
// only some (a Chart Builder's rows follow its target, a mode hides a socket), and layout must see the card as drawn.
// Each rendered socket joins on mount and leaves on unmount; nothing here is saved, since the card redraws it.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

type Side = "input" | "output";
type Live = { input: Map<string, number>; output: Map<string, number> };
type Shown = { input: ReadonlySet<string>; output: ReadonlySet<string> };

// Live counts per card, and the last set a mounted card showed. A card that unmounts whole (a collapsed group's
// member, React Flow drops hidden nodes) keeps that last set: it still has those sockets, it just isn't drawn.
const _live = new Map<string, Live>();
const _last = new Map<string, Shown>();
const { notify, subscribe, version } = createNotifier();

const liveCount = (l: Live) => l.input.size + l.output.size;
const snapshot = (l: Live): Shown => ({ input: new Set(l.input.keys()), output: new Set(l.output.keys()) });

// A load mounts thousands of sockets in one commit, and a mode switch unmounts one set as it mounts the next;
// the snapshot and the notification settle once, after the commit.
const dirty = new Set<string>();
let queued = false;
function touch(nodeId: string) {
  dirty.add(nodeId);
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const id of dirty) {
      const l = _live.get(id);
      if (l && liveCount(l) > 0) _last.set(id, snapshot(l));
    }
    dirty.clear();
    notify();
  });
}

export const presentSocketStore = {
  /** Count one rendered socket; the returned function uncounts it. A socket drawn twice stays until both unmount. */
  mount(nodeId: string, side: Side, key: string): () => void {
    let l = _live.get(nodeId);
    if (!l) _live.set(nodeId, l = { input: new Map(), output: new Map() });
    const m = l[side];
    m.set(key, (m.get(key) ?? 0) + 1);
    touch(nodeId);
    return () => {
      const cur = _live.get(nodeId)?.[side];
      const n = cur?.get(key);
      if (!cur || n === undefined) return;
      if (n > 1) cur.set(key, n - 1);
      else cur.delete(key);
      touch(nodeId);
    };
  },
  /** The socket keys a card shows (its last shown set while it is not drawn), or undefined when it never rendered. */
  get(nodeId: string): Shown | undefined {
    const l = _live.get(nodeId);
    if (l && liveCount(l) > 0) return snapshot(l);
    return _last.get(nodeId);
  },
  forget(nodeId: string) {
    const live = _live.delete(nodeId), last = _last.delete(nodeId);
    if (live || last) notify();
  },
  clear() {
    if (_live.size === 0 && _last.size === 0) return;
    _live.clear();
    _last.clear();
    notify();
  },
  subscribe,
  version,
};

registerNodeForget(presentSocketStore.forget);
registerNodeForgetAll(() => presentSocketStore.clear());

/** A node's declared sockets on one side, narrowed to the ones its card shows; every declared one before it renders. */
export function presentSocketKeys(node: { id: string; inputs?: object; outputs?: object }, side: Side): string[] {
  const declared = Object.keys((side === "input" ? node.inputs : node.outputs) ?? {});
  const shown = presentSocketStore.get(node.id)?.[side];
  return shown ? declared.filter((k) => shown.has(k)) : declared;
}
