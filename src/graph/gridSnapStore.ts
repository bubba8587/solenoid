import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";

// The snap step IS the background dot spacing, so snap points land exactly on visible dots.
// A module singleton so the canvas layer can read it without the main React tree.

/** Background dot spacing in world units; `syncSurfaceBackground` scales the tile from it. */
export const DOT_SPACING = 24;
/** Snap granularity: the visible dot grid (a dot sits on every multiple — FlowSurface
 *  offsets RF's Background pattern onto this lattice, the same one RF's snapToGrid uses). */
export const GRID_SNAP_STEP = DOT_SPACING;

/** Round a world coordinate to the nearest visible dot. */
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

/** Read the persisted snap setting. Call once at startup. */
export function initGridSnap() {
  try { _on = localStorage.getItem(LS_KEY) === "1"; }
  catch { /* ignore */ }
}

export function useGridSnap(): { snap: boolean; toggleSnap: () => void } {
  const snap = useSyncExternalStore(gridSnapStore.subscribe, gridSnapStore.get);
  return { snap, toggleSnap: () => gridSnapStore.toggle() };
}
