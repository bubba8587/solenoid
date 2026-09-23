// [[C23]]
// Import nothing but the notifier: process.ts imports this module.
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
let _forceExact = 0;

function persist(): void {
  try { localStorage.setItem(LS_KEY, _mode); } catch { /* storage can be missing or throw */ }
}

export const calcModeStore = {
  mode: (): CalcMode => _mode,
  isManual: (): boolean => _mode === "manual",
  isSketch: (): boolean => _mode === "sketch",
  dirty: (): boolean => _dirty,
  subscribe: _notifier.subscribe,
  version: _notifier.version,

  setMode(m: CalcMode): boolean {
    if (_mode === m) return false;
    _mode = m;
    if (m === "auto" || m === "sketch") _dirty = false;
    persist();
    _notifier.notify();
    return true;
  },

  markDirty(): void {
    if (!_dirty) { _dirty = true; _notifier.notify(); }
  },

  clearDirty(): void {
    if (_dirty) { _dirty = false; _notifier.notify(); }
  },

  sketchActive: (): boolean => _mode === "sketch" && _forceExact === 0,

  beginForceExact(): void { _forceExact++; },
  endForceExact(): void { _forceExact = Math.max(0, _forceExact - 1); },
};
