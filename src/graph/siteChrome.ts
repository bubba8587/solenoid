// [[C99]] chromeEnvelopeVars
import { createNotifier } from "./storeKit";

// Marketing/website pages (/?landing, /obsidian, and future pages) mount the app's live
// overlays — Report, Note, Table — as read-only shop windows. App-only affordances on
// them (Export a report to a webpage, Dock it to the canvas) have nothing to act on off
// the canvas, so a page suppresses the chrome it doesn't want here on mount and restores
// it on unmount. One store so every overlay agrees and future pages reuse it instead of
// each hiding chrome its own way.

export interface SiteChrome {
  /** The Report's "Export as a webpage" button. */
  export: boolean;
  /** The Report/Note "Dock to the side" button. */
  dock: boolean;
}

// The full in-app chrome. A page overrides only the keys it wants gone.
const APP_CHROME: SiteChrome = { export: true, dock: true };

let _chrome: SiteChrome = APP_CHROME;
const { notify, subscribe } = createNotifier();

export const siteChrome = {
  subscribe,
  get: (): SiteChrome => _chrome,
  /** A page sets the chrome it wants; unspecified keys keep the app default. */
  set(chrome: Partial<SiteChrome>): void {
    _chrome = { ...APP_CHROME, ...chrome };
    notify();
  },
  /** Restore the full app chrome (a page calls this on unmount). */
  reset(): void {
    if (_chrome === APP_CHROME) return;
    _chrome = APP_CHROME;
    notify();
  },
};
