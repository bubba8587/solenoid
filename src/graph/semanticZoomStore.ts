import { createNotifier } from "./storeKit";
import { settingsStore } from "./settingsStore";

let _far = false;
let _scale = 1;
const { notify, subscribe } = createNotifier();

export const semanticZoomStore = {
  set(v: boolean) {
    if (_far === v) return;
    _far = v;
    notify();
  },
  subscribe,
};

subscribe(() => {
  if (typeof document === "undefined") return; // node/test env
  document.documentElement.classList.toggle("solenoid-semantic-zoom", _far);
});

const SEMANTIC_ZOOM_SCALE = 0.3;
export function syncSemanticZoomFor(scale: number): void {
  _scale = scale;
  semanticZoomStore.set(settingsStore.get("semanticZoom") && scale <= SEMANTIC_ZOOM_SCALE);
}

// Toggling the setting while zoomed out re-checks at the current scale, not at the next pan.
settingsStore.subscribe(() => syncSemanticZoomFor(_scale));
