// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { isGraphRebuilding } from "./process";
import { nodeNameStore } from "./nodeNameStore";
import { getOwningEditor } from "./activeGraph";
import { connectionStore } from "./connectionStore";

let _openNodeId: string | null = null;
/** The board's addressable name, which a save keeps: an undo reloads the graph under new ids, and the name finds it. */
let _openName: string | undefined;
const { notify, subscribe, version } = createNotifier();

export const dashboardStore = {
  version,
  subscribe,
  openNodeId: (): string | null => (_openName ? nodeNameStore.byName(_openName) : undefined) ?? _openNodeId,
  open(nodeId: string) {
    if (_openNodeId === nodeId) return;
    _openNodeId = nodeId;
    _openName = nodeNameStore.get(nodeId);
    notify();
  },
  close() {
    if (_openNodeId === null) return;
    _openNodeId = null;
    _openName = undefined;
    notify();
  },
};

// Not while the graph rebuilds: the board stays open through an undo, and its name finds the reloaded node.
registerNodeForget((id) => { if (id === dashboardStore.openNodeId() && !isGraphRebuilding()) dashboardStore.close(); });
registerNodeForgetAll(() => { if (!isGraphRebuilding()) dashboardStore.close(); });


/** The live connection cards a board reads from, anywhere upstream of it, and how fresh the board is: the oldest
 *  fetch among them, since the board is only as current as its stalest source. */
export function boardSources(nodeId: string): { ids: string[]; loading: boolean; failed: number; fetchedAt: number | null } {
  const ed = getOwningEditor(nodeId);
  const seen = new Set<string>([nodeId]);
  const stack = [nodeId];
  const conns = ed?.getConnections() ?? [];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of conns) if (c.target === id && !seen.has(c.source)) { seen.add(c.source); stack.push(c.source); }
  }
  const ids = [...seen].filter((id) => id !== nodeId && connectionStore.getState(id).status !== "idle");
  const states = ids.map((id) => connectionStore.getState(id));
  const times = states.map((s) => s.fetchedAt).filter((t): t is number => typeof t === "number");
  return {
    ids,
    loading: states.some((s) => s.status === "loading"),
    failed: states.filter((s) => s.status === "error").length,
    fetchedAt: times.length ? Math.min(...times) : null,
  };
}
