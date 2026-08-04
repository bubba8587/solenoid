// Open/close state for the Add/Edit Connection dialog (module store; the dialog
// is mounted once in App).
type Prefill = { nodeId: string; socketKey: string };

export type ConnDialogReq = {
  // When set, editing this connection (re-wires it: delete old + add new).
  editId?: string;
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
