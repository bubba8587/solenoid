// The load CURTAIN's phase + progress; persistence.ts's rebuildGraph drives it
// for big loads/switches so node-by-node construction is never seen. (The old
// staged reveal animation died with the rete surface — git has it.)
//
//   idle      → nothing loading; components render normally.
//   building  → graph being constructed behind the progress overlay.

import { createNotifier } from "./storeKit";
import { clamp } from "./nodes/mathUtils";

export type RevealPhase = "idle" | "building";

const { notify, subscribe } = createNotifier();
let _phase: RevealPhase = "idle";
let _progress = 0; // 0..1, accurate during `building`

export const loadRevealStore = {
  subscribe,
  /** True whenever a reveal is in progress (building OR revealing) — components
   *  hide not-yet-revealed elements while this holds. */
  isActive: (): boolean => _phase !== "idle",
  phase: (): RevealPhase => _phase,
  progress: (): number => _progress,

  /** Enter the build phase (progress bar shows, everything hidden). */
  begin(): void {
    _phase = "building";
    _progress = 0;
    notify();
  },
  setProgress(p: number): void {
    _progress = clamp(p, 0, 1);
    notify();
  },
  /** Build done — overlay fades, the staged reveal begins. */
  /** Back to idle; always call from a finally so a failed load can't leave the
   *  canvas stuck hidden. */
  finish(): void {
    if (_phase === "idle") return;
    _phase = "idle";
    notify();
  },
};
