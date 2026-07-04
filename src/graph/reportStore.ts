import { createNotifier } from "./storeKit";

// Open/close + dock state for the Report overlay (ReportOverlay.tsx) — module-level
// singleton (like frStore) so both the ReportNode canvas card (a separate Rete
// React root) and the main app root can open/close it. Tracks WHICH ReportNode is
// open (a document may have more than one Report, even though the typical case is
// one) rather than a bare boolean.
//
// DOCKED (desktop): instead of a centered modal, the report pins to the right side
// of the page between the top chrome and the footer, and the canvas area (canvas,
// minimap, pills, socket legend) is squeezed left. Driven by a root class
// `html.sol-report-docked` (+ the `--report-dock-w` var) so plain CSS does the
// shift. Opening a different report while docked just replaces the docked one
// (single openNodeId). Closing undocks.

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
