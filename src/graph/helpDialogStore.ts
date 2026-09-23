// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";

export type HelpDialog = "about" | "whatsnew";

// Bump when the What's New slides change; it is not the app version.
export const WHATS_NEW_VERSION = "1.4.1";
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
