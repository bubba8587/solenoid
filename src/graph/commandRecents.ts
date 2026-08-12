import { createNotifier } from "./storeKit";

// MRU command labels, shared by the Command Palette AND the menu bar — an action run
// in either records here.
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
  /** Labels, most-recent first. */
  list: (): string[] => _recents,
  /** Record a command as just-used — moves it to the front (deduped, capped). */
  record(label: string) {
    if (!label) return;
    _recents = [label, ..._recents.filter((l) => l !== label)].slice(0, CAP);
    persist();
    notify();
  },
};
