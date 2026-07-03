// ─── Calculation mode ───────────────────────────────────────────────────────────
// Excel's Automatic vs Manual calculation, PLUS a third Solenoid-only mode, Sketch
// (#24). In MANUAL, a live edit or topology change no longer propagates:
// processGraph short-circuits (see process.ts) and just flags the graph DIRTY; the
// user recomputes on demand with Calculate Now / F9. This is the honest escape
// hatch for a heavy graph — nothing recomputes until you ask.
//
// In SKETCH, the graph keeps recomputing live (like auto), but frame-verb execution
// (frameBackend.ts) runs on a deterministic SAMPLE of each source frame instead of
// the full data — fast previews on a huge table. F9 / Calculate Now still forces one
// EXACT pass regardless of mode (`beginForceExact`/`endForceExact`, bracketing
// `requestRecalc` in process.ts) — sketch mode never intercepts it. Auto and sketch
// are mutually exclusive with manual (one CalcMode at a time); an aggregate computed
// over a sample is scaled + marked `__approx` (frame.ts) rather than shown as exact —
// see frameBackend.ts `applySketchScaling`.
//
// What still computes in manual mode: a LOAD / seed / document open (they run inside the
// graph-rebuild gate, which the short-circuit exempts), because we don't persist computed
// values — an opened doc would otherwise be blank. A forced Calculate Now clears dirty.
//
// The mode persists (localStorage) like Excel's per-workbook flag, so a session remembers
// it. `dirty` and the force-exact bracket are runtime-only. This store stays
// dependency-free (process.ts imports IT, one-way) — switching back to Automatic
// triggers the catch-up recompute at the call site.
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

  /** Switch mode. Returns true when it actually changed (the caller runs the
   *  catch-up recompute when switching to "auto" or "sketch" — both recompute
   *  live, so a stale dirty flag from Manual is moot going forward). */
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

  /** True only while sketch mode is selected AND no forced-exact pass is in
   *  flight — the gate frame-verb execution (frameBackend.ts) checks before
   *  sampling a source. */
  sketchActive: (): boolean => _mode === "sketch" && _forceExact === 0,

  /** Bracket a forced-exact recompute (F9 / Calculate Now — see `requestRecalc`
   *  in process.ts): sketch mode's sampling is suppressed for the pass's
   *  duration, so it always runs on the full data even while sketch stays the
   *  selected mode afterward. */
  beginForceExact(): void { _forceExact++; },
  endForceExact(): void { _forceExact = Math.max(0, _forceExact - 1); },
};
