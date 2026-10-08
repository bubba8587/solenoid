// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";

let _openNodeId: string | null = null;
let _docked = false;
const { notify, subscribe, version } = createNotifier();

function syncDockClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("sol-report-docked", _docked && _openNodeId !== null);
}

export const reportStore = {
  version,
  subscribe,
  openNodeId: (): string | null => _openNodeId,
  isDocked: (): boolean => _docked && _openNodeId !== null,
  open(nodeId: string) {
    if (_openNodeId === nodeId) return;
    _openNodeId = nodeId;
    notify();
    syncDockClass();
  },
  close() {
    if (_openNodeId === null) return;
    _openNodeId = null;
    _docked = false;
    notify();
    syncDockClass();
  },
  setDocked(v: boolean) {
    if (_docked === v) return;
    _docked = v;
    notify();
    syncDockClass();
  },
  toggleDock() {
    this.setDocked(!_docked);
  },
};

registerNodeForget((id) => { if (id === _openNodeId) reportStore.close(); });
registerNodeForgetAll(() => reportStore.close());
