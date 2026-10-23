// [[B3]] sameNodeEverywhere (tree/specs/documents/graph-load-teardown-performance.md)
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
  /** Notifies only when the shown percent moves: each notify is a synchronous render of the curtain. */
  setProgress(p: number): void {
    const next = clamp(p, 0, 1);
    const shown = Math.round(next * 100) !== Math.round(_progress * 100);
    _progress = next;
    if (shown) notify();
  },
  /** Always call from a finally, so a failed load can't leave the canvas hidden. */
  finish(): void {
    if (_phase === "idle") return;
    _phase = "idle";
    notify();
  },
};
