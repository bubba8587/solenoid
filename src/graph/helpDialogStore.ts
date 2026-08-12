// The two Help-menu dialogs share one modal slot — only one shows at a time.
import { createValueStore } from "./storeKit";

export type HelpDialog = "about" | "whatsnew";

// The What's New CONTENT version — bump when the slides change. Deliberately
// separate from package.json's app version, which only moves at a tagged release.
export const WHATS_NEW_VERSION = "1.2";
const SEEN_KEY = "solenoid.whatsNewSeen";

const core = createValueStore<HelpDialog>();

function set(v: HelpDialog | null) {
  if (core.get() === v) return;
  if (v === null) core.close(); else core.open(v);
}

export const helpDialogStore = {
  subscribe: core.subscribe,
  version: core.version,
  get: core.get,
  openAbout: () => set("about"),
  openWhatsNew: () => set("whatsnew"),
  close: () => set(null),
};

/** Auto-show What's New ONCE per content release; a first-ever visitor is recorded
 *  SILENTLY, so no modal lands over their first load reveal. */
export function autoShowWhatsNewOnce(): void {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    if (seen === WHATS_NEW_VERSION) return;
    const firstEver = seen === null;
    localStorage.setItem(SEEN_KEY, WHATS_NEW_VERSION);
    if (!firstEver) set("whatsnew");
  } catch {
    /* private mode / quota — skip the auto-show, the menu item still works */
  }
}
