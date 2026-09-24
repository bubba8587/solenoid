import { createNotifier } from "./storeKit";
import { settingsStore } from "./settingsStore";

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

subscribe(() => {
  if (typeof document === "undefined") return; // node/test env
  document.documentElement.classList.toggle("solenoid-semantic-zoom", _far);
});

const SEMANTIC_ZOOM_SCALE = 0.3;
export function syncSemanticZoomFor(scale: number): void {
  semanticZoomStore.set(settingsStore.get("semanticZoom") && scale <= SEMANTIC_ZOOM_SCALE);
}
