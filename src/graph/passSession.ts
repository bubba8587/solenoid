// [[C23]] calcModes, [[D46]] freezeVolatilePerCalc, [[D102]] graphOnCore
// The compute pass's state between passes lives in the graph core (`crates/solenoid-graph/src/session.rs`): the calc
// mode, the dirty flag, the force-exact depth, the recalc generation, the rebuild depth, the single-flight flags and
// the rerun they coalesce. Each transition is the core's; this module keeps the snapshot it answers, which is what
// the UI reads and what a trap's fresh instance takes back.
import {
  sessionSnapshot, sessionRestore, sessionSetMode, sessionDirty, sessionForceExact, sessionNextGeneration,
  sessionRebuild, sessionRebuildScope, sessionMarkTopoDirty, sessionEnter, sessionExit,
} from "./engineWasm/solenoid_graph.js";
import { guarded, wasmEngineLoaded, whenWasmEngineLoads } from "./engineWasm";

export type CalcMode = "auto" | "manual" | "sketch";

export interface SessionSnapshot {
  mode: CalcMode;
  dirty: boolean;
  forceExact: number;
  gen: number;
  rebuilding: number;
  topoDirty: boolean;
  passActive: boolean;
}

/** The rerun a finished pass owes the requests it coalesced. */
export interface Rerun { force: boolean; exact: boolean; changed: string[] }

let _snap: SessionSnapshot = { mode: "auto", dirty: false, forceExact: 0, gen: 0, rebuilding: 0, topoDirty: false, passActive: false };

/** The state as the core last answered it. */
export function session(): SessionSnapshot {
  return _snap;
}

function step<T>(transition: () => T): T {
  return guarded(() => {
    const out = transition();
    _snap = sessionSnapshot() as SessionSnapshot;
    return out;
  });
}

/** The mode a browser persisted, before the core loads; the core takes it when it does. */
export function seedMode(mode: CalcMode): void {
  if (wasmEngineLoaded()) step(() => sessionSetMode(mode));
  else _snap = { ..._snap, mode };
}

whenWasmEngineLoads(() => { sessionRestore(_snap); _snap = sessionSnapshot() as SessionSnapshot; });

export const setMode = (m: CalcMode): boolean => step(() => sessionSetMode(m));
export const setDirty = (dirty: boolean): boolean => step(() => sessionDirty(dirty));
export const forceExact = (begin: boolean): void => step(() => sessionForceExact(begin));
export const nextGeneration = (): number => step(() => sessionNextGeneration());
/** Closing answers whether no scope is open after it. */
export const rebuild = (begin: boolean): boolean => step(() => sessionRebuild(begin));
export const openRebuildScope = (): void => { step(() => sessionRebuildScope(true)); };
/** `[noneOpen, cableChanged]`. */
export const closeRebuildScope = (): [boolean, boolean] => step(() => sessionRebuildScope(false) as [boolean, boolean]);
export const markTopoDirty = (): void => step(() => sessionMarkTopoDirty());
export const enterPass = (changed: string | undefined, force: boolean): "gated" | "queued" | "run" =>
  step(() => sessionEnter(changed, force) as "gated" | "queued" | "run");
export const exitPass = (finished: boolean): Rerun | null => step(() => sessionExit(finished) as Rerun | null);
