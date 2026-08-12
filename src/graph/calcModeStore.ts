// Calculation mode (auto / manual / the Solenoid-only sketch). Must stay
// dependency-free — process.ts imports IT, one way.
import { createNotifier } from "./storeKit";

export type CalcMode = "auto" | "manual" | "sketch";

const LS_KEY = "solenoid.calcMode";
const _notifier = createNotifier();

function readMode(): CalcMode {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === "manual" ? "manual" : v === "sketch" ? "sketch" : "auto";
  } catch { return "auto"; }
}

let _mode: CalcMode = readMode();
let _dirty = false;
// Depth-counted (not boolean): guards against a forced pass's bracket being
// cleared early by an overlapping second forced call.
let _forceExact = 0;

function persist(): void {
  try { localStorage.setItem(LS_KEY, _mode); } catch { /* private mode / no storage */ }
}

export const calcModeStore = {
  mode: (): CalcMode => _mode,
  isManual: (): boolean => _mode === "manual",
  isSketch: (): boolean => _mode === "sketch",
  /** True when a change was suppressed in manual mode and a recompute is pending. */
  dirty: (): boolean => _dirty,
  subscribe: _notifier.subscribe,
  /** useSyncExternalStore snapshot — changes on any mode/dirty transition. */
  version: _notifier.version,

  /** Returns true when the mode actually changed — the caller owes a catch-up
   *  recompute when switching to "auto" or "sketch". */
  setMode(m: CalcMode): boolean {
    if (_mode === m) return false;
    _mode = m;
    if (m === "auto" || m === "sketch") _dirty = false;
    persist();
    _notifier.notify();
    return true;
  },

  /** A suppressed manual-mode change → the graph is now stale. */
  markDirty(): void {
    if (!_dirty) { _dirty = true; _notifier.notify(); }
  },

  /** A (forced) recompute brought the graph up to date. */
  clearDirty(): void {
    if (_dirty) { _dirty = false; _notifier.notify(); }
  },

  /** The gate frame-verb execution checks before sampling: sketch selected AND no
   *  forced-exact pass in flight. */
  sketchActive: (): boolean => _mode === "sketch" && _forceExact === 0,

  /** Bracket a forced-exact recompute (F9): sketch sampling is suppressed for the
   *  pass, so it runs on full data while sketch stays selected. */
  beginForceExact(): void { _forceExact++; },
  endForceExact(): void { _forceExact = Math.max(0, _forceExact - 1); },
};
