// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import { WHATS_NEW_VERSION } from "./whatsNewSlides";

type HelpDialog = "about" | "whatsnew";

// The newest release with slides (whatsNewSlides.ts): a new one shows the dialog once more.
export { WHATS_NEW_VERSION, WHATS_NEW_TITLE } from "./whatsNewSlides";
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
