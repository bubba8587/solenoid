// Log of tagged SolErrors + fuzz findings. Module-level so both React roots read it;
// the error sink fires per relay node, so entries are origin-filtered and edge-detected.

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
  /** Fuzz only — seeds a Clamp on this input; `min`/`max` are the sweep's observed-safe
   *  bounds, absent when it found no usable range. */
  suggestion?: { socketKey: string; label: string; min?: number; max?: number };
}

const MAX_ENTRIES = 200;
let _entries: ProblemEntry[] = [];
let _seq = 0;
const _lastLiveCode = new Map<string, SolErrorCode>();
const { notify, subscribe, version } = createNotifier();

export const problemsStore = {
  list: (): readonly ProblemEntry[] => _entries,

  /** Logs only at the error's TRUE ORIGIN — the sink fires for every relay node, so
   *  one failure wired to N downstream nodes would otherwise log N rows. */
  reportLive(nodeId: string, err: SolError): void {
    // A bulk/synthetic rebuild (fuzz, Tornado, load) computes on values that aren't real
    // graph state; logging it would leave stale rows. The post-load settle runs outside it.
    if (isGraphRebuilding()) return;
    if (err.origin && err.origin.nodeId !== nodeId) return;
    if (_lastLiveCode.get(nodeId) === err.code) return; // same failure, already logged
    _lastLiveCode.set(nodeId, err.code);
    const entry: ProblemEntry = { id: ++_seq, nodeId, code: err.code, message: err.message, origin: "compute", time: Date.now() };
    _entries = [entry, ..._entries].slice(0, MAX_ENTRIES);
    notify();
  },

  /** Clears edge-detect state, not history, so a later RELAPSE of the same code logs. */
  clearLive(nodeId: string): void {
    _lastLiveCode.delete(nodeId);
  },

  /** Wholesale replace: a fresh run supersedes the last rather than accumulating. */
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

// Panel open state lives here, not in the component, so the StatusBar badge can force
// the panel open without prop-drilling.
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
