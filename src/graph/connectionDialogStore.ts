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

import { createValueStore } from "./storeKit";

const core = createValueStore<ConnDialogReq>(); // null = closed

export const connectionDialog = {
  ...core,
  open(req: ConnDialogReq = {}) {
    core.open(req);
  },
};
