import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

export type DockedRelationship = {
  hostNodeId: string;
  socketKey: string;
  side: "input" | "output";
};

const _store = new Map<string, DockedRelationship>();
const { notify, subscribe } = createNotifier();

export const dockedNodeStore = {
  dock(dockedId: string, rel: DockedRelationship): void {
    _store.set(dockedId, rel);
    notify();
  },
  undock(dockedId: string): void {
    if (_store.delete(dockedId)) notify();
  },
  get(dockedId: string): DockedRelationship | undefined {
    return _store.get(dockedId);
  },
  getDockedTo(hostId: string): Array<{ id: string } & DockedRelationship> {
    const result: Array<{ id: string } & DockedRelationship> = [];
    for (const [id, rel] of _store) {
      if (rel.hostNodeId === hostId) result.push({ id, ...rel });
    }
    return result;
  },
  /** Registry forget: the node may be the DOCKED FC or a HOST, and every relationship
   *  it takes part in is dead either way. */
  removeForNode(nodeId: string): void {
    let changed = _store.delete(nodeId);
    for (const [id, rel] of [..._store]) {
      if (rel.hostNodeId === nodeId) { _store.delete(id); changed = true; }
    }
    if (changed) notify();
  },
  clear(): void {
    if (_store.size === 0) return;
    _store.clear();
    notify();
  },
  subscribe,
};

registerNodeForget((nodeId) => dockedNodeStore.removeForNode(nodeId));
registerNodeForgetAll(() => dockedNodeStore.clear());
