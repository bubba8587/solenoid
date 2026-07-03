import { createNotifier } from "./storeKit";

// Open/close state for the Composite drill-in editor
// (components/CompositeEditorOverlay.tsx) — module-level singleton (like
// reportStore) so the CompositeNode card (rete's separate React root), the
// node context menu, and the main app root can all open/close it. Tracks
// WHICH composite is open.

let _openId: string | null = null;
const { notify, subscribe, version } = createNotifier();

export const compositeEditorStore = {
  version,
  subscribe,
  isOpen: (): boolean => _openId !== null,
  openId: (): string | null => _openId,
  open(nodeId: string) {
    if (_openId === nodeId) return;
    _openId = nodeId;
    notify();
  },
  close() {
    if (_openId === null) return;
    _openId = null;
    notify();
  },
};

// Recompute ticker: process.ts notifies after every completed graph pass so
// an OPEN drill-in editor can re-render its internal nodes' value boxes (the
// outer pass recomputes the composite, which recomputes the internal graph —
// but only the overlay knows about its own area plugin, so process.ts can't
// area.update the internal views itself).
const pass = createNotifier();
export const compositePassStore = {
  version: pass.version,
  subscribe: pass.subscribe,
  notify: pass.notify,
};
