import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";

// The snap step IS the background dot spacing, so snap points land exactly on visible dots.
// A module singleton so the canvas layer can read it without the main React tree.

/** Background dot spacing in world units; `syncSurfaceBackground` scales the tile from it. */
export const DOT_SPACING = 24;
/** Snap granularity: the visible dot grid. */
export const GRID_SNAP_STEP = DOT_SPACING;
/** Dots sit at the CENTER of each background tile, so snap must carry the same half-cell
 *  phase or it lands on the tile corners, between dots. */
const DOT_PHASE = DOT_SPACING / 2;

/** Round a world coordinate to the nearest visible dot. */
export function snapCoord(v: number): number {
  return Math.round((v - DOT_PHASE) / GRID_SNAP_STEP) * GRID_SNAP_STEP + DOT_PHASE;
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
