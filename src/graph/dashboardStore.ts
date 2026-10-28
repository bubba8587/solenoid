// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

let _openNodeId: string | null = null;
const { notify, subscribe, version } = createNotifier();

export const dashboardStore = {
  version,
  subscribe,
  openNodeId: (): string | null => _openNodeId,
  open(nodeId: string) {
    if (_openNodeId === nodeId) return;
    _openNodeId = nodeId;
    notify();
  },
  close() {
    if (_openNodeId === null) return;
    _openNodeId = null;
    notify();
  },
};

registerNodeForget((id) => { if (id === _openNodeId) dashboardStore.close(); });
registerNodeForgetAll(() => dashboardStore.close());
