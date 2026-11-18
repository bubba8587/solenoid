// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import type { SolverNode } from "./nodeClasses";

interface SolverLimitsState {
  node: SolverNode;
  title: string;
  accent?: string;
}

/** The Solver's Limits popup, open on one card (frame-verbs.md § Solver). */
export const solverLimits = createValueStore<SolverLimitsState>();
