// [[B10]] reactFlowView (module-singleton store, storeKit)
type Prefill = { nodeId: string; socketKey: string };

export type ConnDialogReq = {
  editId?: string;
  src?: Prefill;
  tgt?: Prefill;
};

import { createValueStore } from "./storeKit";

const core = createValueStore<ConnDialogReq>();

export const connectionDialog = {
  ...core,
  open(req: ConnDialogReq = {}) {
    core.open(req);
  },
};
