// [[B10]] reactFlowView (module-singleton store, storeKit)
// The save-clock read seam: a LEAF module (storeKit only) because a node class cannot
// import documentStore, which injects the provider at module load instead.

import { createNotifier } from "./storeKit";

export interface SaveClock {
  /** Epoch ms of the current doc's last autosave, or null with no doc / no provider. */
  autosavedAt: number | null;
  /** Epoch ms of the current doc's last Save / Save As to a file, or null. */
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

  /** documentStore's registration (headless runs never call it, so reads stay null). */
  setProvider(fn: () => SaveClock): void {
    _read = fn;
    notify();
  },

  /** The provider's backing state moved (a save landed, or the current doc changed). */
  bump: notify,
};
