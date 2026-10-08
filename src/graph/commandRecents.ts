// [[C98]] paletteMirrorsMenubar
import { createNotifier } from "./storeKit";

// Most-recently-used command labels; a run from the Command Palette or the menu bar records here.
const LS_KEY = "solenoid.command.recents";
const CAP = 12;

function load(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, CAP) : [];
  } catch { return []; }
}

let _recents: string[] = load();
const { notify, subscribe, version } = createNotifier();

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_recents)); } catch { /* private mode / quota */ }
}

export const commandRecents = {
  subscribe,
  version,
  list: (): string[] => _recents,
  /** Moves the label to the front, deduplicated and capped. */
  record(label: string) {
    if (!label) return;
    _recents = [label, ..._recents.filter((l) => l !== label)].slice(0, CAP);
    persist();
    notify();
  },
};
