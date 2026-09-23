// [[C43]] oneFlowSurface (tree/specs/documents/graph-load-teardown-performance.md)
// The load curtain's phase and progress, driven by rebuildGraph so node-by-node construction is never seen.

import { createNotifier } from "./storeKit";
import { clamp } from "./nodes/mathUtils";

export type RevealPhase = "idle" | "building";

const { notify, subscribe } = createNotifier();
let _phase: RevealPhase = "idle";
let _progress = 0;

export const loadRevealStore = {
  subscribe,
  isActive: (): boolean => _phase !== "idle",
  phase: (): RevealPhase => _phase,
  progress: (): number => _progress,

  begin(): void {
    _phase = "building";
    _progress = 0;
    notify();
  },
  setProgress(p: number): void {
    _progress = clamp(p, 0, 1);
    notify();
  },
  /** Always call from a finally, so a failed load can't leave the canvas hidden. */
  finish(): void {
    if (_phase === "idle") return;
    _phase = "idle";
    notify();
  },
};
