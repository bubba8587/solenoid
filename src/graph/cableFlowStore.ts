import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";

// "Animated mode" — when on, every live cable carries a stream of beads flowing
// from output to input, so you can watch data travel through the graph. A
// module-level singleton (like cableShapeStore) so ConnectionComponent, rendered
// in Rete's own React root, can read it without the main React tree. Persisted to
// localStorage so the mode survives a reload.

const LS_KEY = "solenoid.cableFlow";

let _on = false;
const { notify, subscribe } = createNotifier();

function persist() {
  try { localStorage.setItem(LS_KEY, _on ? "1" : "0"); }
  catch { /* private mode / quota — non-fatal */ }
}

export const cableFlowStore = {
  get: (): boolean => _on,
  set: (v: boolean) => { if (_on === v) return; _on = v; persist(); notify(); },
  toggle: () => { _on = !_on; persist(); notify(); },
  subscribe,
};

/** Read the persisted flow setting. Call once at startup. */
export function initCableFlow() {
  try { _on = localStorage.getItem(LS_KEY) === "1"; }
  catch { /* ignore */ }
}

export function useCableFlow(): { flow: boolean; toggleFlow: () => void } {
  const flow = useSyncExternalStore(cableFlowStore.subscribe, cableFlowStore.get);
  return { flow, toggleFlow: () => cableFlowStore.toggle() };
}
