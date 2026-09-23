// [[B10]] reactFlowView (module-singleton store, storeKit)
import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";


export const DOT_SPACING = 24;
export const GRID_SNAP_STEP = DOT_SPACING;

export function snapCoord(v: number): number {
  const r = Math.round(v / GRID_SNAP_STEP) * GRID_SNAP_STEP;
  return r === 0 ? 0 : r;
}

const LS_KEY = "solenoid.gridSnap";

let _on = false;
const { notify, subscribe } = createNotifier();

function persist() {
  try { localStorage.setItem(LS_KEY, _on ? "1" : "0"); }
  catch { /* private mode / quota — non-fatal */ }
}

export const gridSnapStore = {
  get: (): boolean => _on,
  set: (v: boolean) => { if (_on === v) return; _on = v; persist(); notify(); },
  toggle: () => { _on = !_on; persist(); notify(); },
  subscribe,
};

export function initGridSnap() {
  try { _on = localStorage.getItem(LS_KEY) === "1"; }
  catch { /* ignore */ }
}

export function useGridSnap(): { snap: boolean; toggleSnap: () => void } {
  const snap = useSyncExternalStore(gridSnapStore.subscribe, gridSnapStore.get);
  return { snap, toggleSnap: () => gridSnapStore.toggle() };
}
