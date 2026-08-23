import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { DataflowEngine } from "rete-engine";
import { Cancelled } from "rete-engine";
import type { HistoryPlugin } from "rete-history-plugin";
import { cableValueStore } from "./cableValueStore";
import { solError } from "./errorValue";
import { perfEnabled, beginPass, passTopNodes, ipcSnapshot } from "./perfProbe";
import { beginCompute, endCompute } from "./computeOverlayStore";
import { calcModeStore } from "./calcModeStore";
import { compositePassStore } from "./compositeEditorStore";
import { clearCollectMemo } from "./frameBackend";
import { resolveTrigModes } from "./trigMode";
import type { Schemes, AreaExtra } from "./schemes";

let _editor: NodeEditor<Schemes> | null = null;
let _engine: DataflowEngine<Schemes> | null = null;
let _area: AreaPlugin<Schemes, AreaExtra> | null = null;
let _history: HistoryPlugin<Schemes> | null = null;

export function setHistoryPlugin(h: HistoryPlugin<Schemes>) {
  _history = h;
}

export function getHistoryPlugin() {
  return _history;
}

export function setEditorRefs(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
) {
  _editor = editor;
  _engine = engine;
  _area = area;
}

export function getArea() {
  return _area;
}

export function getEditor() {
  return _editor;
}

// "Graph is being rebuilt wholesale" guard: behaviors meant only for live user creation
// (e.g. absorbing a dropped node into a group) must NOT run for a load/seed's addNode.
let _rebuilding = 0;
export function beginGraphRebuild() { _rebuilding++; }
export function endGraphRebuild() { _rebuilding = Math.max(0, _rebuilding - 1); }
export function isGraphRebuilding() { return _rebuilding > 0; }

// Node and cable selections are mutually exclusive.
let _unselectAllNodes: () => void = () => {};

export function setUnselectAllNodes(fn: () => void) {
  _unselectAllNodes = fn;
}

export function unselectAllNodes() {
  _unselectAllNodes();
}

// `autoArrange({ groupId })` lays out just that group's members.
let _autoArrange: (opts?: { groupId?: string }) => Promise<void> = async () => {};

export function setAutoArrange(fn: (opts?: { groupId?: string }) => Promise<void>) {
  _autoArrange = fn;
}

export function autoArrange(opts?: { groupId?: string; skipConfirm?: boolean }) {
  return _autoArrange(opts);
}

// One-shot graph cleanup: tidy groups, collapse them, tidy the top level, fit view.
let _cleanup: () => Promise<void> = async () => {};

export function setCleanup(fn: () => Promise<void>) {
  _cleanup = fn;
}

export function cleanup() {
  return _cleanup();
}

// The same path Delete/Backspace takes, so keyboard-less chrome deletes identically.
let _deleteSelected: () => Promise<void> = async () => {};

export function setDeleteSelected(fn: () => Promise<void>) {
  _deleteSelected = fn;
}

export function deleteSelected() {
  return _deleteSelected();
}

// Called when a host node resizes so docked Format Controllers follow their socket.
let _repositionDocked: (hostId: string) => void = () => {};

export function setRepositionDocked(fn: (hostId: string) => void) {
  _repositionDocked = fn;
}

export function repositionDockedNodes(hostId: string) {
  _repositionDocked(hostId);
}

import type { SeedId } from "./seeds";

// "custom" = the live graph no longer matches any seed (edited, restored, or imported).
export type SeedSelection = SeedId | "custom";

let _loadSeed: (id: SeedId) => Promise<void> = async () => {};
let _currentSeedId: SeedSelection = "getting-started";
const _seedListeners = new Set<() => void>();

export function setLoadSeed(fn: (id: SeedId) => Promise<void>) {
  _loadSeed = fn;
}

export async function loadSeed(id: SeedId) {
  await _loadSeed(id);
  setSeedSelection(id);
}

export function setSeedSelection(sel: SeedSelection) {
  if (_currentSeedId === sel) return;
  _currentSeedId = sel;
  for (const l of _seedListeners) l();
}

export function getCurrentSeedId(): SeedSelection {
  return _currentSeedId;
}

// No-op while a graph is loading: loadGraph wraps the whole rebuild in
// begin/endGraphRebuild, so seed and autosave loads don't self-mark custom.
export function markGraphCustom() {
  if (isGraphRebuilding()) return;
  setSeedSelection("custom");
}

export const seedStore = {
  get: (): SeedSelection => _currentSeedId,
  subscribe: (l: () => void) => {
    _seedListeners.add(l);
    return () => { _seedListeners.delete(l); };
  },
};

let _selectNode: (id: string, accumulate: boolean) => void = () => {};

export function setSelectNode(fn: (id: string, accumulate: boolean) => void) {
  _selectNode = fn;
}

export function selectNode(id: string, accumulate: boolean) {
  _selectNode(id, accumulate);
}

// Class-name → constructor registry: copyPaste.ts can't import nodeCtorRegistry
// directly (catalogUtils → nodeCatalog → rete-nodes → composite → copyPaste cycle).
let _ctorRegistryProvider: () => Map<string, new (init?: Record<string, unknown>) => object> = () => new Map();

export function setCtorRegistryProvider(fn: typeof _ctorRegistryProvider) {
  _ctorRegistryProvider = fn;
}

export function getCtorRegistry() {
  return _ctorRegistryProvider();
}

// Bumped by Canvas's editor pipe on connectioncreated / connectionremoved.
let _connVersion = 0;
const _connListeners = new Set<() => void>();

export function bumpConnectionVersion() {
  _connVersion++;
  for (const l of _connListeners) l();
}

export const connectionVersionStore = {
  get: () => _connVersion,
  subscribe: (l: () => void) => {
    _connListeners.add(l);
    return () => { _connListeners.delete(l); };
  },
};

// True across the pickup → drop window (connectionpick / connectiondrop).
let _cableDragging = false;
const _cableDragListeners = new Set<() => void>();

export function setCableDragging(v: boolean) {
  if (_cableDragging === v) return;
  _cableDragging = v;
  for (const l of _cableDragListeners) l();
}

export const cableDragStore = {
  get: () => _cableDragging,
  subscribe: (l: () => void) => {
    _cableDragListeners.add(l);
    return () => { _cableDragListeners.delete(l); };
  },
};

// Bumped whenever a Conduit's `angle` is mutated from OUTSIDE its own React root
// (the Canvas keyboard rotate); ConduitComponent subscribes here.
let _conduitAngleVersion = 0;
const _conduitAngleListeners = new Set<() => void>();

export function bumpConduitAngle() {
  _conduitAngleVersion++;
  for (const l of _conduitAngleListeners) l();
}

export const conduitAngleStore = {
  get: () => _conduitAngleVersion,
  subscribe: (l: () => void) => {
    _conduitAngleListeners.add(l);
    return () => { _conduitAngleListeners.delete(l); };
  },
};

// Recalculation generation: a volatile node rolls a fresh value only on a generation it
// hasn't seen. Global on purpose — every "roll everything" entry point shares one, like F9.
let _recalcGen = 0;

export function getRecalcGen() {
  return _recalcGen;
}

export async function requestRecalc() {
  _recalcGen++;
  // F9 forces one exact recompute (no sketch sampling) regardless of the calc mode.
  calcModeStore.beginForceExact();
  try {
    await processGraph(undefined, undefined, { force: true });
  } finally {
    calcModeStore.endForceExact();
  }
}

// For changes the classic preset doesn't track — e.g. a group resize.
let _pushHistory: (action: { undo: () => void; redo: () => void }) => void = () => {};

export function setPushHistory(fn: (action: { undo: () => void; redo: () => void }) => void) {
  _pushHistory = fn;
}

export function pushHistory(undo: () => void, redo: () => void) {
  _pushHistory({ undo, redo });
}

// MUST be called after every document load/rebuild: the classic preset records
// rebuildGraph's adds, so an uncleared history lets Ctrl+Z unwind the LOAD itself.
let _clearHistory: () => void = () => {};

export function setClearHistory(fn: () => void) {
  _clearHistory = fn;
}

export function clearHistory() {
  _clearHistory();
}

// A registered hook, not an import, so process.ts doesn't import persistence (cycle).
let _graphChanged: () => void = () => {};

export function setGraphChanged(fn: () => void) {
  _graphChanged = fn;
}

// "Settle after a BULK topology change": a per-cable `connectioncreated` settle is
// O(cables × nodes) and freezes the tab, so wrap the add loop in begin/endGraphRebuild
// and call this ONCE at the end.
let _bulkSettle: (renderOnly?: Set<string>) => Promise<void> = async (r) => { await processGraph(undefined, r); };

export function setBulkSettle(fn: (renderOnly?: Set<string>) => Promise<void>) {
  _bulkSettle = fn;
}

// `renderOnly` (additive bulk add, e.g. paste): the added nodes are self-contained, so
// compute without resetting (originals keep their cache) and re-render only them.
export function bulkSettle(renderOnly?: Set<string>) {
  return _bulkSettle(renderOnly);
}

// Set when a cable changes WHILE a rebuild gate is held, so `withGraphRebuild` can skip
// the settle for an op that changed no topology (e.g. undoing a node move).
let _bulkTopoDirty = false;
export function markBulkTopoDirty() { _bulkTopoDirty = true; }

// Runs a bulk mutation with the per-event settle suppressed, then settles ONCE if
// topology actually changed. Not safe for nested use (the dirty flag is a single global).
export async function withGraphRebuild<T>(fn: () => Promise<T>): Promise<T> {
  _bulkTopoDirty = false;
  beginGraphRebuild();
  try {
    return await fn();
  } finally {
    endGraphRebuild();
    const dirty = _bulkTopoDirty;
    _bulkTopoDirty = false;
    if (dirty) await bulkSettle();
  }
}

// The TRUE members of every dependency loop (a self-loop or an SCC of 2+), NOT the nodes
// downstream of one: seeding only these with #CIRC! leaves everything downstream computing
// normally and showing the propagated error.
export function loopMembers(editor: NodeEditor<Schemes>): Set<string> {
  const ids = editor.getNodes().map((n) => n.id);
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  const selfLoops = new Set<string>();
  for (const c of editor.getConnections()) {
    if (c.source === c.target) { selfLoops.add(c.source); continue; }
    if (adj.has(c.source) && adj.get(c.source)!.indexOf(c.target) === -1 && ids.includes(c.target)) {
      adj.get(c.source)!.push(c.target);
    }
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const members = new Set<string>(selfLoops);
  let counter = 0;
  // Iterative Tarjan (recursion would blow the stack on big graphs).
  for (const start of ids) {
    if (index.has(start)) continue;
    const work: Array<{ node: string; i: number }> = [{ node: start, i: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame.node;
      if (frame.i === 0) {
        index.set(v, counter); low.set(v, counter); counter++;
        stack.push(v); onStack.add(v);
      }
      const neighbors = adj.get(v)!;
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i];
        frame.i++;
        if (!index.has(w)) {
          work.push({ node: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      } else {
        if (low.get(v) === index.get(v)) {
          const comp: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
          if (comp.length > 1) for (const id of comp) members.add(id);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
        }
      }
    }
  }
  return members;
}

// Perf probe counter; enable logging with `window.__solenoidPerf = true`.
let _pgCount = 0;

// Cached loop-member set: every TOPOLOGY change routes through a FULL processGraph, which
// recomputes it, so the targeted and additive paths can reuse it.
let _cachedLoop: Set<string> | null = null;

// Downstream closure over outgoing connections — exactly the set rete-engine's
// `reset(nodeId)` invalidates, and the nodes a single value edit can affect.
export function downstreamClosure(editor: NodeEditor<Schemes>, startId: string): Set<string> {
  const out = new Map<string, string[]>();
  for (const c of editor.getConnections()) {
    (out.get(c.source) ?? out.set(c.source, []).get(c.source)!).push(c.target);
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of out.get(id) ?? []) if (!seen.has(t)) { seen.add(t); queue.push(t); }
  }
  return seen;
}

// `changedNodeId` — one node's VALUE changed (no topology change): reset + re-render only
// its downstream cone. Safe ONLY for pure value edits, since data flows solely through
// cables; omit it for any structural change, load, or when unsure.
// `renderOnly` — ADDITIVE bulk mode (paste): the given nodes are self-contained, so DON'T
// reset the engine and re-render only that set. Mutually exclusive with changedNodeId.
// Single-flight guard: exactly ONE pass runs at a time. A recompute requested WHILE a pass
// is in flight — a node's mount/render effect calling processGraph mid-pass (the Conduit's
// realLanes effect is the live one; ~7 component call sites do this) — must NOT re-enter: a
// nested pass shares and corrupts this module's per-pass state (the engine reset/cache, the
// collect memo, the loop set). Under the async DOM render this held only by luck — the effect
// fired a task LATER, after the pass had drained; a synchronous render (a `flushSync` mount)
// fires it mid-render, and the nested pass threw `node is not initialized`. So coalesce: flag
// the request and run exactly one full follow-up pass once the active one settles.
let _passActive = false;
let _rerunQueued = false;
// A coalesced F9 (force) must stay forced, or manual mode's gate would swallow the rerun.
let _rerunForce = false;

export async function processGraph(changedNodeId?: string, renderOnly?: Set<string>, opts?: { force?: boolean; topology?: boolean }) {
  // Manual calculation mode: skip the pass and flag dirty (F9 passes force). A load /
  // seed / paste rebuild is exempt, via the rebuild gate, so an opened document isn't blank.
  if (calcModeStore.isManual() && !opts?.force && !isGraphRebuilding()) {
    calcModeStore.markDirty();
    return;
  }
  if (_passActive) { _rerunQueued = true; _rerunForce ||= opts?.force === true; return; }
  _passActive = true;
  // The `finally` balances the compute-overlay counter and clears the in-flight flag.
  beginCompute();
  try {
    await runGraphPass(changedNodeId, renderOnly, opts?.topology === true);
    // A completed pass clears the manual-mode dirty flag (no-op in auto mode).
    calcModeStore.clearDirty();
  } finally {
    _passActive = false;
    endCompute();
  }
  // Drain a coalesced request as ONE full pass on the now-settled graph — never re-entrant
  // (the flag is clear), so it can't corrupt per-pass state, and a full pass supersets any
  // targeted call that was coalesced. A stable render dep fires no effect, so it can't re-queue.
  if (_rerunQueued) {
    const force = _rerunForce;
    _rerunQueued = false; _rerunForce = false;
    await processGraph(undefined, undefined, force ? { force } : undefined);
  }
}

// The OUTERMOST composite card whose (possibly nested) internal editor holds `innerId`.
// Duck-typed on `internalEditor` to avoid a module cycle (composite.ts imports from here).
function findCompositeOwner(editor: NodeEditor<Schemes>, innerId: string): string | null {
  for (const n of editor.getNodes()) {
    const inner = (n as unknown as { internalEditor?: NodeEditor<Schemes> }).internalEditor;
    if (!inner) continue;
    if (inner.getNode(innerId) || findCompositeOwner(inner, innerId)) return n.id;
  }
  return null;
}

// An internal VALUE edit fires no editor event, so this is where a held heavy solve learns
// its subgraph changed; EVERY composite in the nesting chain must be bumped.
function markInternalEditChain(editor: NodeEditor<Schemes>, innerId: string): boolean {
  for (const n of editor.getNodes()) {
    const c = n as unknown as { internalEditor?: NodeEditor<Schemes>; markInternalEdit?: () => void };
    if (!c.internalEditor) continue;
    if (c.internalEditor.getNode(innerId) || markInternalEditChain(c.internalEditor, innerId)) {
      c.markInternalEdit?.();
      return true;
    }
  }
  return false;
}

async function runGraphPass(changedNodeId?: string, renderOnly?: Set<string>, topologyChanged = false) {
  if (!_editor || !_engine || !_area) return;
  // An edit inside a drill-in targets an internal node id — retarget at the owning card,
  // whose cache entry is the one that must be invalidated.
  if (changedNodeId && !_editor.getNode(changedNodeId)) {
    const owner = findCompositeOwner(_editor, changedNodeId);
    if (owner) {
      markInternalEditChain(_editor, changedNodeId);
      changedNodeId = owner;
    }
  }
  // Fresh per-pass memo: a lazy ref fanned out to N consumers materializes once.
  clearCollectMemo();
  // Must run BEFORE the engine pull, so each MathFn.data() reads a fresh angle mode.
  resolveTrigModes(_editor);
  const perf = perfEnabled();
  if (perf) beginPass();
  const ipc0 = perf ? ipcSnapshot() : null;
  const t0 = perf ? performance.now() : 0;
  const affected = changedNodeId ? downstreamClosure(_editor, changedNodeId) : null;
  // Targeted invalidation walks the BFS cone by hand, NOT `_engine.reset(nodeId)`:
  // rete-engine recurses over outgoing connections with no visited set, so a cable cycle
  // blows the stack before the #CIRC! seeding below runs.
  if (affected) for (const id of affected) _engine.cache.delete(id);
  else if (!renderOnly) _engine.reset(); // additive bulk add keeps existing caches

  // A dependency loop must be seeded BEFORE fetching: the pull engine resolves inputs
  // recursively before calling data(), so it would deadlock. A TOPOLOGY-targeted pass must
  // refresh the loop set — the one thing a cable change invalidates.
  const loop = (changedNodeId || renderOnly) && !topologyChanged
    ? (_cachedLoop ?? (_cachedLoop = loopMembers(_editor)))
    : (_cachedLoop = loopMembers(_editor));
  const circErr = solError("#CIRC!", "This node is part of a circular dependency: the calculation feeds back into itself");
  for (const id of loop) {
    const node = _editor.getNode(id);
    if (!node) continue;
    const outputs: Record<string, unknown> = {};
    for (const k of Object.keys(node.outputs ?? {})) outputs[k] = circErr;
    // The member never runs, so seed its value box directly: `cachedResult` (most),
    // `cachedValue` (Display), `cachedList` (list nodes) — all three, or that family
    // shows a stale value instead of the badge.
    const n = node as unknown as { cachedResult?: unknown; cachedValue?: unknown; cachedList?: unknown };
    if ("cachedResult" in n) n.cachedResult = circErr;
    if ("cachedValue" in n) n.cachedValue = circErr;
    if ("cachedList" in n) n.cachedList = circErr;
    const seeded = Object.assign(Promise.resolve(outputs), { cancel() {} });
    try { _engine.cache.add(id, seeded); } catch { _engine.cache.patch(id, seeded); }
  }

  // Early-cutoff bookkeeping (targeted path only): which cone nodes' outputs CHANGED, and
  // which are display sinks. Compared against the stored value BEFORE it is overwritten.
  const changedOut = affected ? new Set<string>() : null;
  const sinks = affected ? new Set<string>() : null;
  try {
    for (const node of _editor.getNodes()) {
      const outputs = await _engine.fetch(node.id) as Record<string, unknown>;
      if (changedOut) {
        const keys = Object.keys(outputs);
        if (keys.length === 0) sinks!.add(node.id);
        else if (keys.some((k) => cableValueStore.get(node.id, k) !== outputs[k])) changedOut.add(node.id);
      }
      cableValueStore.setNodeOutputs(node.id, outputs);
    }
  } catch (e) {
    // A newer processGraph() canceled this in-flight fetch — swallow only cancellation.
    if (e instanceof Cancelled) return;
    throw e;
  }
  const t1 = perf ? performance.now() : 0;
  cableValueStore.bump();
  // Node updates are independent (each its own React root), so fire them concurrently.
  let toRender = _editor.getNodes();
  if (renderOnly) {
    toRender = toRender.filter((n) => renderOnly.has(n.id));
  } else if (affected) {
    // Early cutoff within the cone: render a node only if its OWN output changed, or it's
    // a display sink fed by a changed source. Object outputs get a fresh reference each
    // run, so the cutoff mainly prunes scalar chains.
    const srcOf = new Map<string, string[]>();
    for (const c of _editor.getConnections()) {
      (srcOf.get(c.target) ?? srcOf.set(c.target, []).get(c.target)!).push(c.source);
    }
    toRender = toRender.filter((n) => {
      if (!affected.has(n.id)) return false;
      if (changedOut!.has(n.id)) return true;
      if (sinks!.has(n.id)) return (srcOf.get(n.id) ?? []).some((s) => changedOut!.has(s));
      return false;
    });
  }
  await Promise.all(toRender.map((node) => _area!.update("node", node.id)));
  if (perf) {
    const t2 = performance.now();
    const ipc1 = ipcSnapshot();
    const ipcCalls = ipc1.calls - (ipc0?.calls ?? 0);
    const ipcMs = ipc1.ms - (ipc0?.ms ?? 0);
    const top = passTopNodes(5)
      .filter((n) => n.ms >= 0.5)
      .map((n) => `${n.type}=${n.ms.toFixed(1)}ms`)
      .join(" ");
    console.log(
      `[perf] processGraph #${++_pgCount}  nodes=${_editor.getNodes().length} conns=${_editor.getConnections().length}  ` +
      `${affected ? `targeted=${changedNodeId} rendered=${toRender.length}  ` : renderOnly ? `additive rendered=${toRender.length}  ` : "FULL  "}` +
      `compute=${(t1 - t0).toFixed(1)}ms  render=${(t2 - t1).toFixed(1)}ms  total=${(t2 - t0).toFixed(1)}ms  ` +
      `ipc=${ipcCalls}call/${ipcMs.toFixed(1)}ms${top ? `  slowest: ${top}` : ""}`,
    );
  }
  // An open drill-in editor re-renders its internal node views off this tick.
  compositePassStore.notify();
  _graphChanged();
}
