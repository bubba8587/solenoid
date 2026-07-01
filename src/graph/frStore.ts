// Open/close + active-tab state for the Reference overlay (Function Reference /
// Help / Notes tabs). A small custom store rather than a bare toggle so the Help
// menu can open straight to a given tab.
import { createNotifier } from "./storeKit";

export type FrTab = "reference" | "sockets" | "help" | "notes";

let _open = false;
let _tab: FrTab = "reference";
const { notify, subscribe, version } = createNotifier();

export const frStore = {
  /** useSyncExternalStore snapshot for the open flag. */
  get: (): boolean => _open,
  /** useSyncExternalStore snapshot for the active tab. */
  tab: (): FrTab => _tab,
  /** Bumps on any change (open/close/tab) — for components that want one sub. */
  version,
  subscribe,

  /** Open the overlay, optionally jumping to a tab (default keeps the current). */
  open(tab?: FrTab) {
    if (tab) _tab = tab;
    if (!_open) _open = true;
    notify();
  },
  close() { if (_open) { _open = false; notify(); } },
  /** Toggle open/closed, leaving the tab as-is (used by the toolbar book + Ctrl+/). */
  toggle() { _open = !_open; notify(); },
  setTab(tab: FrTab) { if (_tab !== tab) { _tab = tab; notify(); } },
};
