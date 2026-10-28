// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { isGraphRebuilding } from "./process";
import { nodeNameStore } from "./nodeNameStore";

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

