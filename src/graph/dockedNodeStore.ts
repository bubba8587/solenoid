import { createNotifier } from "./storeKit";

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
  subscribe,
};
