import { createNotifier } from "./storeKit";
import { settingsStore } from "./settingsStore";
import { syncHairlineFor } from "./hairline";

let _far = false;
const { notify, subscribe, version } = createNotifier();

export const semanticZoomStore = {
  get: (): boolean => _far,
  set(v: boolean) {
    if (_far === v) return;
    _far = v;
    notify();
  },
  version,
  subscribe,
};

// A root-level class so plain CSS — not a React subscription in every node
// component — does the swap.
subscribe(() => {
  if (typeof document === "undefined") return; // node/test env
  document.documentElement.classList.toggle("solenoid-semantic-zoom", _far);
});

const SEMANTIC_ZOOM_SCALE = 0.3;
/** The one place the camera scale reaches the DOM: every zoom site calls this. */
export function syncSemanticZoomFor(scale: number): void {
  semanticZoomStore.set(settingsStore.get("semanticZoom") && scale <= SEMANTIC_ZOOM_SCALE);
  syncHairlineFor(scale);
}
