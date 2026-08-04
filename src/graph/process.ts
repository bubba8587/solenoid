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
// The rete-history-plugin instance Canvas owns — read by the Session History node;
// undo/redo go through pushHistory/clearHistory below.
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

// "Graph is being rebuilt wholesale" guard. Load/seed create every node via addNode
// (firing `nodecreated`); behaviors meant only for live, one-off user creation (e.g.
// absorbing a new node into the group it's dropped inside) must NOT run for those —
// membership on load comes from the saved `members`, never from spatial overlap.
let _rebuilding = 0;
export function beginGraphRebuild() { _rebuilding++; }
export function endGraphRebuild() { _rebuilding = Math.max(0, _rebuilding - 1); }
export function isGraphRebuilding() { return _rebuilding > 0; }

// Registered by Canvas (which owns the selectableNodes selector instance). Node and
// cable selections are mutually exclusive.
let _unselectAllNodes: () => void = () => {};

export function setUnselectAllNodes(fn: () => void) {
  _unselectAllNodes = fn;
}

export function unselectAllNodes() {
  _unselectAllNodes();
}

// Registered by Canvas. `autoArrange({ groupId })` lays out just that group's members.
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

// Registered by Canvas — the same path Delete/Backspace takes, so keyboard-less
// chrome (the mobile controls) deletes through identical logic.
let _deleteSelected: () => Promise<void> = async () => {};

export function setDeleteSelected(fn: () => Promise<void>) {
  _deleteSelected = fn;
}

export function deleteSelected() {
  return _deleteSelected();
}

// Registered by Canvas. Called when a host node resizes so docked Format
// Controllers follow their socket to its new position.
let _repositionDocked: (hostId: string) => void = () => {};

export function setRepositionDocked(fn: (hostId: string) => void) {
  _repositionDocked = fn;
}

export function repositionDockedNodes(hostId: string) {
  _repositionDocked(hostId);
}

import type { SeedId } from "./seeds";

// "custom" = the live graph is no longer a pristine seed (edited, restored from
// autosave, or imported), so the dropdown must not name a seed it no longer matches.
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

// No-op while a graph is loading: loadGraph wraps the whole rebuild (including its
// final processGraph) in begin/endGraphRebuild, so seed and autosave loads don't
// self-mark custom — they set their selection explicitly.
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

// Registered by Canvas (wrapping the selectableNodes helper's `select`).
let _selectNode: (id: string, accumulate: boolean) => void = () => {};

export function setSelectNode(fn: (id: string, accumulate: boolean) => void) {
  _selectNode = fn;
}

export function selectNode(id: string, accumulate: boolean) {
  _selectNode(id, accumulate);
}

// Class-name → constructor registry, registered by Canvas. copyPaste.ts can't import
// nodeCtorRegistry directly — catalogUtils → nodeCatalog → rete-nodes →
// nodes/composite.ts → copyPaste.ts is a cycle; this hook breaks it.
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

// True across the pickup → drop window; set by Canvas from rete-connection-plugin's
// connectionpick / connectiondrop.
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
// (the Canvas keyboard rotate) — ConduitComponent derives its angle from
// `node.angle` and subscribes here. The in-component AngleDial bumps it too.
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

// Recalculation generation for volatile nodes. A volatile node rolls a fresh value
// only when it sees a generation it hasn't rolled for yet, so ordinary evaluations
// keep its value stable. Global on purpose: every "roll everything" entry point
// (node button, toolbar, palette) shares one generation, like Excel's F9.
let _recalcGen = 0;

export function getRecalcGen() {
  return _recalcGen;
}

export async function requestRecalc() {
  _recalcGen++;
  // beginForceExact suppresses sketch mode's sampling (frameBackend.ts) for this ONE
  // pass — F9 forces an exact recompute regardless of the selected calc mode.
  calcModeStore.beginForceExact();
  try {
    await processGraph(undefined, undefined, { force: true });
  } finally {
    calcModeStore.endForceExact();
  }
}

// For changes the classic preset doesn't track on its own — e.g. a group resize
// (width/height + membership).
let _pushHistory: (action: { undo: () => void; redo: () => void }) => void = () => {};

export function setPushHistory(fn: (action: { undo: () => void; redo: () => void }) => void) {
  _pushHistory = fn;
}

export function pushHistory(undo: () => void, redo: () => void) {
  _pushHistory({ undo, redo });
}

// MUST be called after every document load/rebuild: the classic preset records each
// add/remove `rebuildGraph` makes, so an uncleared history lets Ctrl+Z unwind the
// LOAD itself — re-adding the previous document's nodes into the current canvas,
// which the next autosave then persists into the current slot.
let _clearHistory: () => void = () => {};

export function setClearHistory(fn: () => void) {
  _clearHistory = fn;
}

export function clearHistory() {
  _clearHistory();
}

// Graph-changed callback (registered by Canvas → persistence.scheduleAutosave).
// Kept as a registered hook so process.ts doesn't import persistence (cycle).
let _graphChanged: () => void = () => {};

export function setGraphChanged(fn: () => void) {
  _graphChanged = fn;
}

// "Settle after a BULK topology change" hook, registered by Canvas. A bulk mutation
// must NOT let the per-cable `connectioncreated` settle fire once per cable — that is
// O(cables × nodes) and freezes the tab. The caller wraps its add loop in
// begin/endGraphRebuild (skipping the per-cable pipe) and calls this ONCE at the end.
let _bulkSettle: (renderOnly?: Set<string>) => Promise<void> = async (r) => { await processGraph(undefined, r); };

export function setBulkSettle(fn: (renderOnly?: Set<string>) => Promise<void>) {
  _bulkSettle = fn;
}

// `renderOnly` (additive bulk add, e.g. paste): the added nodes form a self-contained
// set that doesn't touch existing nodes, so compute without resetting (originals keep
// their cache → no recompute) and re-render only the new nodes.
export function bulkSettle(renderOnly?: Set<string>) {
  return _bulkSettle(renderOnly);
}

// Set by the Canvas connection pipe when a cable is added/removed WHILE a rebuild
// gate is held, so `withGraphRebuild` can skip the settle for an op that changed no
// topology (e.g. undoing a node move).
let _bulkTopoDirty = false;
export function markBulkTopoDirty() { _bulkTopoDirty = true; }

// Run a bulk graph mutation with the per-event `connectioncreated` settle suppressed,
// then settle ONCE — and only if the mutation actually changed topology. Use for any
// op that adds/removes many nodes/cables in a loop. Not safe for nested use (the
// dirty flag is a single global).
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

// The TRUE members of every dependency loop — the nodes that actually sit on a
// cycle (a self-loop, or a strongly-connected component of 2+ nodes), NOT the
// innocent nodes downstream of one. Tarjan's SCC. We seed only these with #CIRC!
// so everything downstream computes normally and shows the *propagated* error
// (a Display still shows the badge; an ISERROR still explains it). Marking the
// descendants too would blank their own computation.
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

// Cached loop-member set (Tarjan SCC). Every TOPOLOGY change routes through a FULL
// processGraph, which recomputes and stores the set; the targeted (changedNodeId) and
// additive (renderOnly) paths reuse it — guaranteed fresh, since any topology change
// came through a full pass first.
let _cachedLoop: Set<string> | null = null;

// Downstream closure of a node over outgoing connections — exactly the set
// rete-engine's `reset(nodeId)` invalidates (it walks `source === id → target`
// recursively). Used by a TARGETED processGraph to recompute + re-render only the
// nodes a single value-edit can affect. Exported for the targeted-recompute test.
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

// `changedNodeId` — a single node's VALUE changed (a literal/slider/dropdown edit, no
// topology change). Reset only that node + its downstream dependents and re-render
// only that cone; untouched branches keep their cached outputs and their DOM. Omit it
// (the default) for any structural change, load, or when unsure → full reset +
// render-all. The targeted path is only safe for pure value edits because data flows
// solely through cables, so the downstream cone is the complete set of affected nodes.
// `renderOnly` — ADDITIVE bulk mode (paste): the given nodes were just added and form
// a self-contained set (no edges to pre-existing nodes), so DON'T reset the engine
// (originals keep their cached outputs → no recompute; only the new, uncached nodes
// fetch) and re-render only that set. Mutually exclusive with changedNodeId.
export async function processGraph(changedNodeId?: string, renderOnly?: Set<string>, opts?: { force?: boolean; topology?: boolean }) {
  // Manual calculation mode: a live value edit or topology change does NOT propagate.
  // Skip the pass and flag the graph dirty; the user recomputes on demand with Calculate
  // Now / F9 (which passes force). A load / seed / paste rebuild is exempt (it runs inside
  // the graph-rebuild gate) so an opened document isn't blank — we don't persist results.
  if (calcModeStore.isManual() && !opts?.force && !isGraphRebuilding()) {
    calcModeStore.markDirty();
    return;
  }
  // The `finally` guarantees the compute-overlay counter balances on every exit path
  // (the no-editor guard, the Cancelled early-return, a throw).
  beginCompute();
  try {
    const result = await runGraphPass(changedNodeId, renderOnly, opts?.topology === true);
    // A completed pass brings the graph up to date — clear the manual-mode dirty flag
    // (idempotent no-op in auto mode).
    calcModeStore.clearDirty();
    return result;
  } finally {
    endCompute();
  }
}

// A composite's internal node isn't in the outer editor — find the OUTERMOST
// composite card whose (possibly nested) internal editor holds it. Duck-typed
// on `internalEditor` to avoid a module cycle (composite.ts imports from here).
function findCompositeOwner(editor: NodeEditor<Schemes>, innerId: string): string | null {
  for (const n of editor.getNodes()) {
    const inner = (n as unknown as { internalEditor?: NodeEditor<Schemes> }).internalEditor;
    if (!inner) continue;
    if (inner.getNode(innerId) || findCompositeOwner(inner, innerId)) return n.id;
  }
  return null;
}

// An internal VALUE edit fires no editor event (only topology is piped inside
// composite.ts), so this is where a held heavy solve learns its subgraph changed.
// EVERY composite in the nesting chain must be bumped so each level's stale dot lights.
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
  // An edit made inside a composite's drill-in editor targets an internal node
  // id. Retarget the pass at the owning card: its cache entry is what must be
  // invalidated, and its data() re-runs the whole internal graph anyway.
  if (changedNodeId && !_editor.getNode(changedNodeId)) {
    const owner = findCompositeOwner(_editor, changedNodeId);
    if (owner) {
      markInternalEditChain(_editor, changedNodeId);
      changedNodeId = owner;
    }
  }
  // Fresh per-pass memo for lazy-frame collects: within one pass a ref fanned out to
  // N consumers materializes once, not N times.
  clearCollectMemo();
  // Must run BEFORE the engine pull, so each MathFn.data() reads a fresh angle mode.
  // The one place compute consults the unit plane.
  resolveTrigModes(_editor);
  const perf = perfEnabled();
  if (perf) beginPass();
  const ipc0 = perf ? ipcSnapshot() : null;
  const t0 = perf ? performance.now() : 0;
  const affected = changedNodeId ? downstreamClosure(_editor, changedNodeId) : null;
  // Targeted invalidation is done by hand over the BFS cone, NOT via the library's
  // `_engine.reset(nodeId)`: rete-engine walks outgoing connections RECURSIVELY with
  // no visited set, so a cable cycle blows the stack before the #CIRC! seeding below
  // runs. `downstreamClosure` is the same set, cycle-safe; cache.delete fires the
  // same cancel hook reset uses.
  if (affected) for (const id of affected) _engine.cache.delete(id);
  else if (!renderOnly) _engine.reset(); // additive bulk add keeps existing caches

  // A dependency loop must be handled BEFORE fetching: the pull-based engine resolves
  // inputs recursively before calling data(), so it would deadlock. Pre-seeding the
  // loop's true members with #CIRC! dead-ends only them; everything downstream
  // computes normally and shows the propagated error. (engine.cache is a documented
  // public field; the seeded value mimics the engine's own Cancellable.)
  // A TOPOLOGY-targeted pass must refresh the loop set — the one thing a cable
  // change invalidates.
  const loop = (changedNodeId || renderOnly) && !topologyChanged
    ? (_cachedLoop ?? (_cachedLoop = loopMembers(_editor)))
    : (_cachedLoop = loopMembers(_editor));
  const circErr = solError("#CIRC!", "This node is part of a circular dependency: the calculation feeds back into itself");
  for (const id of loop) {
    const node = _editor.getNode(id);
    if (!node) continue;
    const outputs: Record<string, unknown> = {};
    for (const k of Object.keys(node.outputs ?? {})) outputs[k] = circErr;
    // The member never runs, so set its value box directly: most render
    // `cachedResult`, a Display reads `cachedValue`, list nodes render `cachedList`
    // — all three must be seeded or that family shows a stale value, not the badge.
    const n = node as unknown as { cachedResult?: unknown; cachedValue?: unknown; cachedList?: unknown };
    if ("cachedResult" in n) n.cachedResult = circErr;
    if ("cachedValue" in n) n.cachedValue = circErr;
    if ("cachedList" in n) n.cachedList = circErr;
    const seeded = Object.assign(Promise.resolve(outputs), { cancel() {} });
    try { _engine.cache.add(id, seeded); } catch { _engine.cache.patch(id, seeded); }
  }

  // Early-cutoff bookkeeping (targeted path only): which cone nodes' outputs
  // actually CHANGED value, and which are display sinks (no outputs). Compared by
  // reference/primitive vs the last stored value BEFORE we overwrite it.
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
    // A newer processGraph() reset the engine and canceled this in-flight fetch —
    // expected when calls overlap; the newer run finishes and renders. Swallow only
    // cancellation; rethrow anything real.
    if (e instanceof Cancelled) return;
    throw e;
  }
  const t1 = perf ? performance.now() : 0;
  cableValueStore.bump();
  // Re-render node React roots. Updates are independent per node (each its own root),
  // so fire them concurrently and await one barrier, not an N-deep await chain.
  let toRender = _editor.getNodes();
  if (renderOnly) {
    toRender = toRender.filter((n) => renderOnly.has(n.id));
  } else if (affected) {
    // Early cutoff within the cone: render a node only if its OWN output changed, or
    // it's a display sink (no outputs) fed by a source whose output changed. Object
    // outputs (lists/frames) get a fresh reference each run, so they always count as
    // changed; the cutoff mainly prunes scalar/primitive chains.
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
