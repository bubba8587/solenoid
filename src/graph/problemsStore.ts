// Problems log: every tagged SolError the graph has produced, plus model-fuzzing
// findings — the data feeding the Problems HUD panel (components/
// ProblemsPanel.tsx). Companion to alertStore/pinStore: a module-level store so
// both React roots (main app + rete node root) can read it.
//
// Live entries are fed by errorValue.ts's error-sink hook, which fires whenever a
// node's OWN output becomes an error (a throw, an input-propagation short-circuit,
// or a producer just returning a SolError with no throw at all — e.g. Divide's
// #DIV/0!) — including every downstream node the error merely passes through.
// reportLive collapses that down to ONE row per failure, at the error's tagged
// ORIGIN node (errorValue.ts's provenance), not every relay site. Edge-detected
// per node (same-code repeats across recomputes are not re-logged) so a
// continuously-failing node doesn't spam the log — a NEW failure (or the same
// node failing a DIFFERENT way) gets its own row.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { registerErrorSink, type SolError, type SolErrorCode } from "./errorValue";
import { isGraphRebuilding } from "./process";

export type ProblemOrigin = "compute" | "fuzz";

export interface ProblemEntry {
  id: number;
  nodeId: string;
  code: SolErrorCode;
  message: string;
  origin: ProblemOrigin;
  time: number;
  /** A mechanical-fix affordance (model fuzzing only): insert a Clamp node ahead
   *  of this input to keep the offending value in range. `min`/`max` are the
   *  observed-safe bounds captured during the sweep, used to SEED the Clamp
   *  (absent when the sweep saw no usable safe range). */
  suggestion?: { socketKey: string; label: string; min?: number; max?: number };
}

const MAX_ENTRIES = 200;
let _entries: ProblemEntry[] = [];
let _seq = 0;
const _lastLiveCode = new Map<string, SolErrorCode>();
const { notify, subscribe, version } = createNotifier();

export const problemsStore = {
  list: (): readonly ProblemEntry[] => _entries,

  /** A live compute-pass hit (see errorValue.ts's error sink). Logs only at the
   *  error's TRUE ORIGIN — the sink fires for every node an error's output
   *  passes through, so without this a single failure wired to N downstream
   *  nodes would produce N rows for the same underlying cause. Falls back to
   *  logging here if origin is somehow unset (defensive; installErrorGuards
   *  should always tag it). */
  reportLive(nodeId: string, err: SolError): void {
    // Don't log during a bulk/synthetic rebuild — a model-fuzz or Tornado sweep
    // (and a document load) drives many transient passes on values that aren't the
    // real graph state; logging them leaves stale "compute" rows after the run.
    // Mirrors the fireAlert edge-detect gate. The post-load settle runs OUTSIDE the
    // rebuild scope, so genuine errors on a freshly-loaded doc still surface.
    if (isGraphRebuilding()) return;
    if (err.origin && err.origin.nodeId !== nodeId) return;
    if (_lastLiveCode.get(nodeId) === err.code) return; // same failure, already logged
    _lastLiveCode.set(nodeId, err.code);
    const entry: ProblemEntry = { id: ++_seq, nodeId, code: err.code, message: err.message, origin: "compute", time: Date.now() };
    _entries = [entry, ..._entries].slice(0, MAX_ENTRIES);
    notify();
  },

  /** The node computed CLEAN this pass — reset its edge-detect so a RELAPSE of
   *  the same code later logs as the genuinely new occurrence it is (the
   *  last-code map otherwise suppressed it forever once the error cleared).
   *  Logged entries stay — this clears detection state, not history. */
  clearLive(nodeId: string): void {
    _lastLiveCode.delete(nodeId);
  },

  /** Replace the fuzz-origin findings wholesale — a fresh fuzz run supersedes
   *  the last one rather than accumulating across runs. */
  setFuzzFindings(findings: ReadonlyArray<Omit<ProblemEntry, "id" | "time" | "origin">>): void {
    const fresh: ProblemEntry[] = findings.map((f) => ({ ...f, id: ++_seq, time: Date.now(), origin: "fuzz" as const }));
    _entries = [...fresh, ..._entries.filter((e) => e.origin !== "fuzz")].slice(0, MAX_ENTRIES);
    notify();
  },

  dismiss(id: number): void {
    const next = _entries.filter((e) => e.id !== id);
    if (next.length !== _entries.length) { _entries = next; notify(); }
  },

  clearOrigin(origin: ProblemOrigin): void {
    const next = _entries.filter((e) => e.origin !== origin);
    if (next.length !== _entries.length) { _entries = next; notify(); }
  },

  removeForNode(nodeId: string): void {
    _lastLiveCode.delete(nodeId);
    const next = _entries.filter((e) => e.nodeId !== nodeId);
    if (next.length !== _entries.length) { _entries = next; notify(); }
  },

  clear(): void {
    _lastLiveCode.clear();
    if (_entries.length > 0) { _entries = []; notify(); }
  },

  subscribe,
  version,
};

registerErrorSink((nodeId, err) => {
  if (err) problemsStore.reportLive(nodeId, err);
  else problemsStore.clearLive(nodeId);
});
registerNodeForget((nodeId) => problemsStore.removeForNode(nodeId));
registerNodeForgetAll(() => problemsStore.clear());

// ─── Panel open/collapse — lifted out of the component (unlike Pin/Alert's local
// useState) so the StatusBar badge can force the panel open without prop-drilling.
let _panelOpen = false;
const panelNotifier = createNotifier();
export const problemsPanelUi = {
  isOpen: (): boolean => _panelOpen,
  setOpen(open: boolean): void {
    if (_panelOpen === open) return;
    _panelOpen = open;
    panelNotifier.notify();
  },
  version: panelNotifier.version,
  subscribe: panelNotifier.subscribe,
};
