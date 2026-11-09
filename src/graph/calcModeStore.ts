// [[C23]]
// The calc mode and the dirty flag as the UI reads them. The state machine is the graph core's (`passSession.ts`);
// this store persists the mode per browser and tells subscribers when the mode or the flag moves.
import { createNotifier } from "./storeKit";
import { session, seedMode, setMode, setDirty, forceExact, type CalcMode } from "./passSession";

export type { CalcMode };

const LS_KEY = "solenoid.calcMode";
const _notifier = createNotifier();

function readMode(): CalcMode {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === "manual" ? "manual" : v === "sketch" ? "sketch" : "auto";
  } catch { return "auto"; }
}

seedMode(readMode());

function persist(): void {
  try { localStorage.setItem(LS_KEY, session().mode); } catch { /* storage can be missing or throw */ }
}

export const calcModeStore = {
  mode: (): CalcMode => session().mode,
  isManual: (): boolean => session().mode === "manual",
  isSketch: (): boolean => session().mode === "sketch",
  dirty: (): boolean => session().dirty,
  subscribe: _notifier.subscribe,
  version: _notifier.version,

  setMode(m: CalcMode): boolean {
    if (!setMode(m)) return false;
    persist();
    _notifier.notify();
    return true;
  },

  markDirty(): void {
    if (setDirty(true)) _notifier.notify();
  },

  clearDirty(): void {
    if (setDirty(false)) _notifier.notify();
  },

  /** Runs a session transition made on the pass's behalf (its gate, its end), notifying when the flag moved. */
  track<T>(transition: () => T): T {
    const was = session().dirty;
    const out = transition();
    if (session().dirty !== was) _notifier.notify();
    return out;
  },

  sketchActive: (): boolean => session().mode === "sketch" && session().forceExact === 0,
  forcingExact: (): boolean => session().forceExact > 0,

  beginForceExact(): void { forceExact(true); },
  endForceExact(): void { forceExact(false); },
};
