// Which Expression node's formula popup is open (its node id), or null.
// Module store (not React context): the expand button lives inside a node, which
// Rete renders in a separate React root, so it can't reach an app-level overlay
// through context. The popup is mounted once in App and reads this store. Mirrors
// connectionDialogStore / frStore.
import { createNotifier } from "./storeKit";

let _nodeId: string | null = null;
const { notify, subscribe } = createNotifier();

export const formulaPopup = {
  get: (): string | null => _nodeId,
  open(nodeId: string) {
    if (_nodeId === nodeId) return;
    _nodeId = nodeId;
    notify();
  },
  close() {
    if (_nodeId === null) return;
    _nodeId = null;
    notify();
  },
  subscribe,
};
