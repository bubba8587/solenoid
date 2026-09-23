// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createNotifier } from "./storeKit";

// WHICH report is open (a document may hold several) and whether it is docked; the root
// class `html.sol-report-docked` drives the layout shift (tree/specs/canvas/layout-chrome.md).

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
