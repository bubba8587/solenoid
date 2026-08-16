// Session-scoped save clock: when the document was last autosaved, and when it was last
// written to a file. A LEAF module (storeKit only) — documentStore and fileSession reach
// rete through persistence, so a node class can only read the clock from here.

import { createNotifier } from "./storeKit";

const { notify, subscribe, version } = createNotifier();

let _autosaveAt: number | null = null;
let _fileSaveAt: number | null = null;

export const saveTimeStore = {
  subscribe,
  version,

  /** Epoch ms of the last autosave, or null when none has run this session. */
  lastAutosaveAt: (): number | null => _autosaveAt,
  /** Epoch ms of the last write to a file, or null when none has run this session. */
  lastFileSaveAt: (): number | null => _fileSaveAt,

  markAutosave(at: number = Date.now()): void {
    _autosaveAt = at;
    notify();
  },

  markFileSave(at: number = Date.now()): void {
    _fileSaveAt = at;
    notify();
  },

  clear(): void {
    _autosaveAt = null;
    _fileSaveAt = null;
    notify();
  },
};
