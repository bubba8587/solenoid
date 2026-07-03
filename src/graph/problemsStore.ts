// Problems log: every tagged SolError the graph has produced, plus (later) model-
// fuzzing findings — the data feeding the Problems HUD panel (components/
// ProblemsPanel.tsx). Companion to alertStore/pinStore: a module-level store so
// both React roots (main app + rete node root) can read it.
//
// Live entries are fed by errorValue.ts's error-sink hook, which fires whenever a
// node's OWN output becomes an error (a throw, an input-propagation short-circuit,
// or a producer just returning a SolError with no throw at all — e.g. Divide's
// #DIV/0!). Edge-detected per node (same-code repeats across recomputes are not
// re-logged) so a continuously-failing node doesn't spam the log — a NEW failure
// (or the same node failing a DIFFERENT way) gets its own row.

import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { registerErrorSink, type SolError, type SolErrorCode } from "./errorValue";

export type ProblemOrigin = "compute" | "fuzz";

export interface ProblemEntry {
  id: number;
  nodeId: string;
  code: SolErrorCode;
  message: string;
  origin: ProblemOrigin;
  time: number;
  /** A mechanical-fix affordance (model fuzzing only): insert a Clamp node ahead
   *  of this input to keep the offending value in range. */
  suggestion?: { socketKey: string; label: string };
}

const MAX_ENTRIES = 200;
let _entries: ProblemEntry[] = [];
let _seq = 0;
const _lastLiveCode = new Map<string, SolErrorCode>();
const { notify, subscribe, version } = createNotifier();

export const problemsStore = {
  list: (): readonly ProblemEntry[] => _entries,

  /** A live compute-pass hit (see errorValue.ts's error sink). */
  reportLive(nodeId: string, err: SolError): void {
    if (_lastLiveCode.get(nodeId) === err.code) return; // same failure, already logged
    _lastLiveCode.set(nodeId, err.code);
    const entry: ProblemEntry = { id: ++_seq, nodeId, code: err.code, message: err.message, origin: "compute", time: Date.now() };
    _entries = [entry, ..._entries].slice(0, MAX_ENTRIES);
    notify();
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

registerErrorSink((nodeId, err) => problemsStore.reportLive(nodeId, err));
registerNodeForget((nodeId) => problemsStore.removeForNode(nodeId));
registerNodeForgetAll(() => problemsStore.clear());

// ─── Panel open/collapse — lifted out of the component (unlike Pin/Alert's local
// useState) so the StatusBar badge can force the panel open without prop-drilling.
let _panelOpen = false;
const _panelListeners = new Set<() => void>();
let _panelVersion = 0;
export const problemsPanelUi = {
  isOpen: (): boolean => _panelOpen,
  setOpen(open: boolean): void {
    if (_panelOpen === open) return;
    _panelOpen = open;
    _panelVersion++;
    for (const l of _panelListeners) l();
  },
  version: (): number => _panelVersion,
  subscribe(l: () => void): () => void { _panelListeners.add(l); return () => { _panelListeners.delete(l); }; },
};
