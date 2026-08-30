// The app's recompute: the MAIN editor/engine/view refs, the rebuild guard, and
// processGraph — the model pass (graphCompute.ts) plus what the view needs around
// it (targeted re-render, cable values, perf, the compute overlay, calc mode).
// Chrome verbs live in canvasCommands.ts; this module owns compute only.
import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { DataflowEngine } from "rete-engine";
import { Cancelled } from "rete-engine";
import { cableValueStore } from "./cableValueStore";
import { downstreamClosure, loopMembers, seedLoopErrors } from "./graphCompute";
import { perfEnabled, beginPass, passTopNodes, ipcSnapshot } from "./perfProbe";
import { beginCompute, endCompute } from "./computeOverlayStore";
import { calcModeStore } from "./calcModeStore";
import { compositePassStore } from "./compositeEditorStore";
import { clearCollectMemo } from "./frameBackend";
import { resolveTrigModes } from "./trigMode";
import type { Schemes } from "./schemes";

let _editor: NodeEditor<Schemes> | null = null;
let _engine: DataflowEngine<Schemes> | null = null;
let _view: View | null = null;

export function setEditorRefs(
  editor: NodeEditor<Schemes>,
  engine: DataflowEngine<Schemes>,
  view: View,
) {
  _editor = editor;
  _engine = engine;
  _view = view;
}

export function getView() {
  return _view;
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

// Perf probe counter; enable logging with `window.__solenoidPerf = true`.
let _pgCount = 0;

// Cached loop-member set: every TOPOLOGY change routes through a FULL processGraph, which
// recomputes it, so the targeted and additive paths can reuse it.
let _cachedLoop: Set<string> | null = null;

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
  if (!_editor || !_engine || !_view) return;
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
  seedLoopErrors(_editor, _engine, loop);

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
  await Promise.all(toRender.map((node) => _view!.rerenderNode(node.id)));
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
