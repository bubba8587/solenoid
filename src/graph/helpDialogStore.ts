// The two Help-menu dialogs — "About Solenoid" and "What's New" — share one modal
// slot (only one shows at a time). A tiny mode store, plus the once-per-release
// auto-show for What's New (localStorage-flagged, dismissible, re-openable from Help).
import { createValueStore } from "./storeKit";

export type HelpDialog = "about" | "whatsnew";

// The What's New CONTENT version — bump when the slides change for a release so a
// returning user sees the new set once. Deliberately separate from package.json's
// app version (which only bumps at a tagged release, lagging the dev feature set).
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

/**
 * Auto-show What's New ONCE per content release. First-ever visitors (no flag yet)
 * are recorded silently — they get the app itself as their intro, not a modal over
 * the load reveal; a returning user whose flag predates this release sees it once.
 * Idempotent and private-mode-safe.
 */
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
