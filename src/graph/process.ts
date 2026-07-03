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
import { clearCollectMemo } from "./frameBackend";
import type { Schemes, AreaExtra } from "./schemes";

let _editor: NodeEditor<Schemes> | null = null;
let _engine: DataflowEngine<Schemes> | null = null;
let _area: AreaPlugin<Schemes, AreaExtra> | null = null;
// The rete-history-plugin instance Canvas owns — a reference for the Session
// History node (no other current use reads it; undo/redo already go through
// pushHistory/clearHistory below). Rete renders nodes in a separate React root
// with no access to Canvas's closure, so this is the module-singleton pattern
// every other Canvas-owned handle (editor/engine/area) already uses.
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

// "Graph is being rebuilt wholesale" guard. Set while loading a saved graph or
// building a seed — both create every node via addNode (firing `nodecreated`),
// and behaviors meant only for live, one-off user creation (e.g. absorbing a new
// node into the group it's dropped inside) must NOT run for those. Membership on
// load/seed comes from the explicit saved `members`, not from spatial overlap.
let _rebuilding = 0;
export function beginGraphRebuild() { _rebuilding++; }
export function endGraphRebuild() { _rebuilding = Math.max(0, _rebuilding - 1); }
export function isGraphRebuilding() { return _rebuilding > 0; }

// Unselect-all-nodes callback registered by Canvas (which owns the
// selectableNodes selector instance). ConnectionComponent calls
// `unselectAllNodes()` when a cable is selected so node + cable
// selections stay mutually exclusive.
let _unselectAllNodes: () => void = () => {};

export function setUnselectAllNodes(fn: () => void) {
  _unselectAllNodes = fn;
}

export function unselectAllNodes() {
  _unselectAllNodes();
}

// Auto-arrange handler registered by Canvas. NavMenu calls `autoArrange()`
// (global / selection scope) when the tidy button is pressed; a group's own
// Tidy button calls `autoArrange({ groupId })` to lay out just its members.
let _autoArrange: (opts?: { groupId?: string }) => Promise<void> = async () => {};

export function setAutoArrange(fn: (opts?: { groupId?: string }) => Promise<void>) {
  _autoArrange = fn;
}

export function autoArrange(opts?: { groupId?: string; skipConfirm?: boolean }) {
  return _autoArrange(opts);
}

// One-shot graph cleanup (Ctrl+Shift+L): tidy groups, collapse them, tidy the
// top level, fit view. Registered by Canvas; triggered by the hotkey / menu.
let _cleanup: () => Promise<void> = async () => {};

export function setCleanup(fn: () => Promise<void>) {
  _cleanup = fn;
}

export function cleanup() {
  return _cleanup();
}

// Delete-selection handler registered by Canvas. Mirrors the Delete/Backspace
// keyboard path so chrome without a keyboard (the mobile controls) can remove
// the selected cable or nodes through the exact same logic.
let _deleteSelected: () => Promise<void> = async () => {};

export function setDeleteSelected(fn: () => Promise<void>) {
  _deleteSelected = fn;
}

export function deleteSelected() {
  return _deleteSelected();
}

// Reposition-docked-nodes handler registered by Canvas. NodeCard calls this
// when a host node resizes (e.g. a list display box grows a row) so any docked
// Format Controllers follow the socket to its new position.
let _repositionDocked: (hostId: string) => void = () => {};

export function setRepositionDocked(fn: (hostId: string) => void) {
  _repositionDocked = fn;
}

export function repositionDockedNodes(hostId: string) {
  _repositionDocked(hostId);
}

// Seed loader registered by Canvas. NavMenu / SeedSwitcher calls
// `loadSeed(id)` to clear the graph and load a named seed.
import type { SeedId } from "./seeds";

// What the seed dropdown shows. "custom" means the live graph is no longer a
// pristine seed — the user edited it, or a non-seed working graph was restored
// from autosave / imported — so the dropdown reads "Current graph" instead of
// misleadingly naming a seed the file no longer matches.
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

// Flip the dropdown to "Current graph" on a genuine user edit. No-op while a
// graph is loading: loadGraph wraps the whole rebuild (including its final
// processGraph, which fires graphChanged) in begin/endGraphRebuild, so seed and
// autosave loads don't self-mark custom — they set their selection explicitly.
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

// Node selection API registered by Canvas (wrapping the selectableNodes
// helper's `select` function). Box-select uses it to add nodes by id.
let _selectNode: (id: string, accumulate: boolean) => void = () => {};

export function setSelectNode(fn: (id: string, accumulate: boolean) => void) {
  _selectNode = fn;
}

export function selectNode(id: string, accumulate: boolean) {
  _selectNode(id, accumulate);
}

// Class-name → constructor registry, registered by Canvas (it wraps
// nodeCtorRegistry.ts). copyPaste.ts needs this to hydrate a pasted
// CompositeNode's internal subgraph (see nodes/composite.ts `hydrate`), but
// can't import nodeCtorRegistry directly: that module chains through
// catalogUtils → nodeCatalog → rete-nodes → nodes/composite.ts → copyPaste.ts,
// a cycle. Indirection through this registered hook (the same pattern as
// setLoadSeed / setAutoArrange above) breaks it.
let _ctorRegistryProvider: () => Map<string, new (init?: Record<string, unknown>) => object> = () => new Map();

export function setCtorRegistryProvider(fn: typeof _ctorRegistryProvider) {
  _ctorRegistryProvider = fn;
}

export function getCtorRegistry() {
  return _ctorRegistryProvider();
}

// Components (the Conduit) that need to re-render on any connection
// change subscribe to this counter. Canvas bumps it from the editor
// pipe on connectioncreated / connectionremoved.
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

// Tracks whether the user is currently dragging a cable from a socket
// (pickup → drop window). Set by Canvas via rete-connection-plugin's
// connectionpick / connectiondrop events. Used by the Conduit to reveal
// phantom socket slots only while a connection is in progress.
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
// (the Canvas keyboard rotate, `[` / `]`). The ConduitComponent derives its angle
// from `node.angle` and subscribes here so an external rotate re-renders it; the
// in-component AngleDial bumps the same store so both paths share one mechanism.
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

// Recalculation generation for volatile nodes (RANDBETWEEN and any
// future RAND/NOW/etc.). A volatile node rolls a fresh value only when
// it sees a generation it hasn't rolled for yet — so ordinary graph
// evaluations (editing an unrelated Scalar) keep its value stable.
// `requestRecalc()` bumps the generation and re-evaluates the whole
// graph. It's intentionally global so a node's recalc button, a future
// toolbar button, or a command palette entry can all trigger the same
// "roll everything" the way Excel's F9 recalculates volatiles.
let _recalcGen = 0;

export function getRecalcGen() {
  return _recalcGen;
}

export async function requestRecalc() {
  _recalcGen++;
  // Calculate Now / F9: always compute, even in manual mode (that's the whole point),
  // and reroll volatiles. `force` also clears the manual-mode dirty flag. Bracketed
  // with beginForceExact/endForceExact so sketch mode's sampling (frameBackend.ts)
  // is suppressed for this ONE pass — F9 always forces an exact recompute regardless
  // of the selected calc mode.
  calcModeStore.beginForceExact();
  try {
    await processGraph(undefined, undefined, { force: true });
  } finally {
    calcModeStore.endForceExact();
  }
}

// Push a custom undo/redo action onto the history stack (registered by Canvas,
// which owns the HistoryPlugin). Used for changes the classic preset doesn't
// track on its own — e.g. a group resize (width/height + membership).
let _pushHistory: (action: { undo: () => void; redo: () => void }) => void = () => {};

export function setPushHistory(fn: (action: { undo: () => void; redo: () => void }) => void) {
  _pushHistory = fn;
}

export function pushHistory(undo: () => void, redo: () => void) {
  _pushHistory({ undo, redo });
}

// Clear the whole undo history (registered by Canvas — HistoryPlugin.clear()).
// Called after every document load/rebuild: the classic preset records each
// add/remove `rebuildGraph` makes, so an un-cleared history let Ctrl+Z unwind
// the LOAD itself — deleting freshly-loaded nodes and re-adding the PREVIOUS
// document's node objects into the current canvas, which the next autosave
// then persisted into the current slot (audit P0-5).
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

// "Settle after a BULK topology change" hook, registered by Canvas (which owns the
// FC reconcile / mismatch rescan / group-collapse closures). A bulk mutation —
// paste, and any other op that adds many nodes/cables in a loop — must NOT let the
// per-cable `connectioncreated` settle fire once per cable (that is O(cables × nodes)
// and freezes/crashes the tab on a large paste). Instead the caller wraps its add
// loop in begin/endGraphRebuild (so the per-cable pipe is skipped) and calls this
// ONCE at the end. Mirrors the end-of-`rebuildGraph` settle. Runs reconcileFcTypes +
// bumpConnectionVersion + rescanMismatches + processGraph + syncGroupCollapse.
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
// gate is held. `withGraphRebuild` reads it to decide whether one settle is needed
// after a gated bulk op — so an op that changed NO topology (e.g. undoing a node
// move) skips the settle entirely instead of paying a full recompute.
let _bulkTopoDirty = false;
export function markBulkTopoDirty() { _bulkTopoDirty = true; }

// Run a bulk graph mutation with the per-event `connectioncreated` settle suppressed,
// then settle ONCE — and only if the mutation actually changed topology. Use for any
// op that adds/removes many nodes/cables in a loop: run per-cable, that settle is
// O(cables × nodes) and freezes/crashes the tab at scale (see the paste-crash fix).
// Not designed for nested use (the dirty flag is a single global).
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
      const neighbours = adj.get(v)!;
      if (frame.i < neighbours.length) {
        const w = neighbours[frame.i];
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

// Lightweight perf probe. Off by default (just a boolean read). Turn it on from
// the devtools console with `window.__solenoidPerf = true` to log, per
// processGraph, the COMPUTE phase (engine fetch of every node) vs the RENDER
// phase (cableValueStore.bump + area.update of every node), plus the running
// call count and graph size — so the compute/render split and call frequency are
// visible without React/Chrome profiling. Set it back to false to stop.
let _pgCount = 0;

// Cached loop-member set (Tarjan SCC). The full Tarjan is O(N+E) and ran on EVERY
// processGraph — including per-keystroke value edits — even though a value edit can't
// change topology. Every TOPOLOGY change (connection/node add/remove) routes through a
// FULL processGraph (Canvas's connectioncreated/removed pipe calls the bare form, load/
// paste settle via bulkSettle), so we recompute the set on the full path and STORE it;
// the targeted (changedNodeId) and additive (renderOnly) paths reuse the stored set —
// it's guaranteed fresh, since any topology change came through a full pass first.
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
  // Bracket every pass with the compute-overlay counter. The overlay is DEFERRED
  // (computeOverlayStore) so a fast pass finishes before it would ever show; only a
  // genuinely heavy pass (a big CSV refresh, a large join) crosses the reveal delay
  // and gets the busy curtain. finally guarantees the counter balances on any exit
  // (the no-editor guard, the Cancelled early-return, a throw).
  beginCompute();
  try {
    const result = await runGraphPass(changedNodeId, renderOnly, opts?.topology === true);
    // A completed pass (forced recompute, or a load that computed) brings the graph up
    // to date — clear the manual-mode dirty flag (idempotent no-op in auto mode).
    calcModeStore.clearDirty();
    return result;
  } finally {
    endCompute();
  }
}

async function runGraphPass(changedNodeId?: string, renderOnly?: Set<string>, topologyChanged = false) {
  if (!_editor || !_engine || !_area) return;
  // Fresh per-pass memo for lazy-frame collects: within one pass a ref fanned
  // out to N consumers materializes once, not N times (audit finding 24).
  clearCollectMemo();
  const perf = perfEnabled();
  if (perf) beginPass();
  const ipc0 = perf ? ipcSnapshot() : null;
  const t0 = perf ? performance.now() : 0;
  const affected = changedNodeId ? downstreamClosure(_editor, changedNodeId) : null;
  // Targeted invalidation is done by hand over the BFS cone, NOT via the
  // library's `_engine.reset(nodeId)`: rete-engine walks outgoing connections
  // RECURSIVELY with no visited set, so on a graph with a cable cycle it
  // chases the loop forever and throws "Maximum call stack size exceeded"
  // before the #CIRC! seeding below ever runs. `downstreamClosure` is the
  // exact same set (that equivalence is what processTargeted.test.ts guards),
  // computed cycle-safely; cache.delete fires the same cancel hook reset uses.
  if (affected) for (const id of affected) _engine.cache.delete(id);
  else if (!renderOnly) _engine.reset(); // additive bulk add keeps existing caches

  // A dependency loop must be handled BEFORE fetching: the pull-based engine
  // resolves a node's inputs (recursively) before calling its data(), so it would
  // DEADLOCK forever on a loop. We pre-seed the engine's result cache for the loop's
  // true members with a #CIRC! value, so when a downstream node fetches one it gets
  // the cached error instead of recursing into the loop. Everything downstream then
  // computes normally and shows the PROPAGATED #CIRC! (a Display badge, an ISERROR
  // explanation) — only the actual loop members are dead-ended. (engine.cache is a
  // documented public field; the seeded value mimics the engine's own Cancellable.)
  // Full path recomputes the loop set (topology may have changed) and caches it;
  // targeted/additive reuse the cache (fresh by construction — see _cachedLoop).
  // A TOPOLOGY-targeted pass (a single cable connect/disconnect, audit finding
  // 40) must refresh it too — the one thing a cable change invalidates.
  const loop = (changedNodeId || renderOnly) && !topologyChanged
    ? (_cachedLoop ?? (_cachedLoop = loopMembers(_editor)))
    : (_cachedLoop = loopMembers(_editor));
  const circErr = solError("#CIRC!", "This node is part of a circular dependency — the calculation feeds back into itself");
  for (const id of loop) {
    const node = _editor.getNode(id);
    if (!node) continue;
    const outputs: Record<string, unknown> = {};
    for (const k of Object.keys(node.outputs ?? {})) outputs[k] = circErr;
    // The member never runs, so set its value box directly (most render
    // `cachedResult`; a Display reads `cachedValue`).
    const n = node as unknown as { cachedResult?: unknown; cachedValue?: unknown };
    if ("cachedResult" in n) n.cachedResult = circErr;
    if ("cachedValue" in n) n.cachedValue = circErr;
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
      // A loop member fetches straight from the seeded cache (no recursion); a
      // descendant resolves the member through that same cache, so its own data()
      // runs against #CIRC! and propagates it.
      const outputs = await _engine.fetch(node.id) as Record<string, unknown>;
      if (changedOut) {
        const keys = Object.keys(outputs);
        if (keys.length === 0) sinks!.add(node.id);
        else if (keys.some((k) => cableValueStore.get(node.id, k) !== outputs[k])) changedOut.add(node.id);
      }
      cableValueStore.setNodeOutputs(node.id, outputs);
    }
  } catch (e) {
    // A newer processGraph() called engine.reset() and cancelled our
    // in-flight fetch. Expected when calls overlap (seed load fires one
    // per connection) — the newer run finishes and renders. Swallow only
    // cancellation; rethrow anything real.
    if (e instanceof Cancelled) return;
    throw e;
  }
  const t1 = perf ? performance.now() : 0;
  cableValueStore.bump();
  // Re-render node React roots. A full pass renders every node (preserve prior
  // behavior); a targeted pass renders only the affected downstream cone. The updates
  // are independent per node (each its own root), so fire them concurrently and await
  // one barrier instead of an N-deep await chain.
  let toRender = _editor.getNodes();
  if (renderOnly) {
    toRender = toRender.filter((n) => renderOnly.has(n.id));
  } else if (affected) {
    // Early cutoff within the cone: render a node only if its OWN output changed,
    // or it's a display sink (no outputs) fed by a source whose output changed. A
    // node that recomputed to an identical value (a clamp that stays clamped, a
    // comparison that stays true) — and its pure-downstream — keep their DOM. Note
    // object outputs (lists/frames) get a fresh reference each run, so they always
    // count as changed; the cutoff mainly prunes scalar/primitive chains.
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
  _graphChanged();
}
