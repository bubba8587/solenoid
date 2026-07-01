import { useEffect, useState } from "react";
import { createNotifier } from "./storeKit";

// Snap-to-grid: when on, a node dropped after a drag rounds its position to the
// nearest grid point. The grid is aligned to the canvas background dots (24px in
// world coords — see Canvas syncBackground); the snap step IS the dot spacing, so
// snap points land exactly on the visible dots (no half sub-grid).
//
// Module-level singleton (like cableFlowStore) so the canvas layer can read it
// without the main React tree; persisted to localStorage so it survives reload.

/** Background dot spacing in world units (mirrors the 24 in Canvas syncBackground). */
export const DOT_SPACING = 24;
/** Snap granularity: the visible dot grid (24px). */
export const GRID_SNAP_STEP = DOT_SPACING;
/** The dots are the CENTRE of each background tile (the radial-gradient default),
 * so they sit half a cell off the tile grid — at world `DOT_PHASE + 24·n`. Snap
 * must carry the same phase or it lands on the tile corners (between dots). */
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
  const [snap, setSnap] = useState(_on);
  useEffect(() => gridSnapStore.subscribe(() => setSnap(gridSnapStore.get())), []);
  return { snap, toggleSnap: () => gridSnapStore.toggle() };
}
