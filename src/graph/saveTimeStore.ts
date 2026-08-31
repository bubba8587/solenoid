// The save-clock read seam. The clocks live per-document on SolDoc (updatedAt = last
// autosave, fileSavedAt = last write to a file), but documentStore reaches rete through
// persistence, so a node class can't import it — documentStore injects the provider
// here at module load instead. A LEAF module (storeKit only), like the process.ts
// setPushHistory pattern.

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
