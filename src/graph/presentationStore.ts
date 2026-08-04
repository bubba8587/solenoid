import { createNotifier } from "./storeKit";

// Which Presentation node (if any) is RUNNING as a full-screen slideshow; the overlay
// owns the running index + camera, the node just holds the ordered steps.

let _nodeId: string | null = null;
const { notify, subscribe, version } = createNotifier();

export const presentationStore = {
  version,
  subscribe,
  activeId: (): string | null => _nodeId,
  isActive: (): boolean => _nodeId !== null,
  start(nodeId: string) {
    if (_nodeId === nodeId) return;
    _nodeId = nodeId;
    notify();
  },
  stop() {
    if (_nodeId === null) return;
    _nodeId = null;
    notify();
  },
};
