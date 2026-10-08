// [[B14]] oneDesignSystem
import { createNotifier } from "./storeKit";

// Marketing pages mount the live overlays read-only and hide chrome with nothing to act on off the canvas; one
// store so every overlay agrees.

export interface SiteChrome {
  /** The Report's "Export as a webpage" button. */
  export: boolean;
  /** The Report/Note "Dock to the side" button. */
  dock: boolean;
}

const APP_CHROME: SiteChrome = { export: true, dock: true };

let _chrome: SiteChrome = APP_CHROME;
const { notify, subscribe } = createNotifier();

export const siteChrome = {
  subscribe,
  get: (): SiteChrome => _chrome,
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
