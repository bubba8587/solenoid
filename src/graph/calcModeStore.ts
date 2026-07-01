// ─── Calculation mode ───────────────────────────────────────────────────────────
// Excel's Automatic vs Manual calculation. In MANUAL, a live edit or topology change
// no longer propagates: processGraph short-circuits (see process.ts) and just flags the
// graph DIRTY; the user recomputes on demand with Calculate Now / F9. This is the honest
// escape hatch for a heavy graph — nothing recomputes until you ask.
//
// What still computes in manual mode: a LOAD / seed / document open (they run inside the
// graph-rebuild gate, which the short-circuit exempts), because we don't persist computed
// values — an opened doc would otherwise be blank. A forced Calculate Now clears dirty.
//
// The mode persists (localStorage) like Excel's per-workbook flag, so a session remembers
// it. `dirty` is runtime-only. This store stays dependency-free (process.ts imports IT,
// one-way) — switching back to Automatic triggers the catch-up recompute at the call site.
import { createNotifier } from "./storeKit";

export type CalcMode = "auto" | "manual";

const LS_KEY = "solenoid.calcMode";
const _notifier = createNotifier();

function readMode(): CalcMode {
  try { return localStorage.getItem(LS_KEY) === "manual" ? "manual" : "auto"; }
  catch { return "auto"; }
}

let _mode: CalcMode = readMode();
let _dirty = false;

function persist(): void {
  try { localStorage.setItem(LS_KEY, _mode); } catch { /* private mode / no storage */ }
}

export const calcModeStore = {
  mode: (): CalcMode => _mode,
  isManual: (): boolean => _mode === "manual",
  /** True when a change was suppressed in manual mode and a recompute is pending. */
  dirty: (): boolean => _dirty,
  subscribe: _notifier.subscribe,
  /** useSyncExternalStore snapshot — changes on any mode/dirty transition. */
  version: _notifier.version,

  /** Switch mode. Returns true when it actually changed (the caller runs the
   *  catch-up recompute when switching to "auto"). Auto clears dirty. */
  setMode(m: CalcMode): boolean {
    if (_mode === m) return false;
    _mode = m;
    if (m === "auto") _dirty = false;
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
};
