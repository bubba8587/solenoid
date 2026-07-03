import { createNotifier } from "./storeKit";

// Open/close state for the Report overlay (ReportOverlay.tsx) — module-level
// singleton (like frStore) so both the ReportNode canvas card (a separate Rete
// React root) and the main app root can open/close it. Tracks WHICH ReportNode is
// open (a document may have more than one Report, even though the typical case is
// one) rather than a bare boolean.

let _openNodeId: string | null = null;
const { notify, subscribe, version } = createNotifier();

export const reportStore = {
  version,
  subscribe,
  isOpen: (): boolean => _openNodeId !== null,
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
