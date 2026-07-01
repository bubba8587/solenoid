// Open/close state for the Add/Edit Connection dialog (module store so the
// MenuBar's Insert command and, later, the Navigator can drive it; the dialog
// is mounted once in App).
type Prefill = { nodeId: string; socketKey: string };

export type ConnDialogReq = {
  // When set, editing this connection (re-wires it: delete old + add new).
  editId?: string;
  // Optional prefilled endpoints (e.g. opened from a node's socket).
  src?: Prefill;
  tgt?: Prefill;
};

import { createNotifier } from "./storeKit";

let _req: ConnDialogReq | null = null; // null = closed
const { notify, subscribe } = createNotifier();

export const connectionDialog = {
  get: (): ConnDialogReq | null => _req,
  open(req: ConnDialogReq = {}) {
    _req = req;
    notify();
  },
  close() {
    if (_req === null) return;
    _req = null;
    notify();
  },
  subscribe,
};
