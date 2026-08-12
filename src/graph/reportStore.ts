import { createNotifier } from "./storeKit";

// A module singleton so the ReportNode's own React root and the main app root both reach
// it; it tracks WHICH report is open, since a document may hold more than one. Docking is
// driven by the root class `html.sol-report-docked` so plain CSS does the layout shift.

let _openNodeId: string | null = null;
let _docked = false;
const { notify, subscribe, version } = createNotifier();

function syncDockClass(): void {
  if (typeof document === "undefined") return; // node/test env
  document.documentElement.classList.toggle("sol-report-docked", _docked && _openNodeId !== null);
}

export const reportStore = {
  version,
  subscribe,
  isOpen: (): boolean => _openNodeId !== null,
  openNodeId: (): string | null => _openNodeId,
  /** True only while a report is BOTH open and docked. */
  isDocked: (): boolean => _docked && _openNodeId !== null,
  open(nodeId: string) {
    if (_openNodeId === nodeId) return;
    _openNodeId = nodeId;
    notify();
    syncDockClass(); // a docked report shows the newly-opened one
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
