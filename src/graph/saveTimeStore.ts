// [[B10]] reactFlowView (module-singleton store, storeKit)
// A leaf module (storeKit only), because a node class cannot import documentStore; documentStore injects the provider.

import { createNotifier } from "./storeKit";

export interface SaveClock {
  autosavedAt: number | null;
  fileSavedAt: number | null;
}

const EMPTY: SaveClock = { autosavedAt: null, fileSavedAt: null };

const { notify, subscribe, version } = createNotifier();
let _read: () => SaveClock = () => EMPTY;

export const saveTimeStore = {
  subscribe,
  version,

  lastAutosaveAt: (): number | null => _read().autosavedAt,
  lastFileSaveAt: (): number | null => _read().fileSavedAt,

  setProvider(fn: () => SaveClock): void {
    _read = fn;
    notify();
  },

  bump: notify,
};
