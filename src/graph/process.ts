// [[A1]], [[C23]] calcModes, [[D46]] freezeVolatilePerCalc (getRecalcGen), [[D102]] graphOnCore
// The app's pass: its entry order and its body run in the graph core (`passSession.ts`, `engine.pass`); this module
// holds the main editor, engine and view and does what touches them: the overlay, the cable values, the render.
import type { View } from "./view";
import type { GraphEditor } from "./graphEditor";
import type { DataflowEngine } from "./dataflowEngine";
import { cableValueStore } from "./cableValueStore";
import { perfEnabled, beginPass, passTopNodes, ipcSnapshot } from "./perfProbe";
import { beginCompute, endCompute } from "./computeOverlayStore";
import { calcModeStore } from "./calcModeStore";
import { session, nextGeneration, rebuild, openRebuildScope, closeRebuildScope, markTopoDirty, enterPass, exitPass } from "./passSession";
import { compositePassStore } from "./compositeEditorStore";
import { clearCollectMemo } from "./frameBackend";
import { resolveTrigModes } from "./trigMode";
import type { Schemes } from "./schemes";

let _editor: GraphEditor<Schemes> | null = null;
let _engine: DataflowEngine<Schemes> | null = null;
let _view: View | null = null;

export function setEditorRefs(
  editor: GraphEditor<Schemes>,
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

export function getEngine() {
  return _engine;
}

const rebuildEndListeners = new Set<() => void>();
export function beginGraphRebuild() { rebuild(true); }
export function endGraphRebuild() {
  if (rebuild(false)) rebuildEnded();
}
function rebuildEnded() {
  for (const fn of [...rebuildEndListeners]) fn();
}
/** Runs when the outermost rebuild ends, so a surface can apply what it held back during one. */
export function onGraphRebuildEnd(fn: () => void): () => void {
  rebuildEndListeners.add(fn);
  return () => { rebuildEndListeners.delete(fn); };
}
export function isGraphRebuilding() { return session().rebuilding > 0; }

export function getRecalcGen() {
  return session().gen;
}

export async function requestRecalc() {
  nextGeneration();
  calcModeStore.beginForceExact();
  try {
    await processGraph(undefined, undefined, { force: true });
  } finally {
    calcModeStore.endForceExact();
  }
}

/** Runs `fn` after an exact full pass when Sketch is selected, so a sink's Run writes every row, not the sample. */
export async function withExactPass<T>(fn: () => Promise<T>): Promise<T> {
  if (!calcModeStore.isSketch()) return fn();
  calcModeStore.beginForceExact();
  try {
    // A pass in flight would only queue this one and return before it ran.
    while (session().passActive) await new Promise((r) => setTimeout(r, 16));
    await processGraph(undefined, undefined, { force: true });
    return await fn();
  } finally {
    calcModeStore.endForceExact();
  }
}

// A registered hook, because importing persistence would cycle.
let _graphChanged: () => void = () => {};

export function setGraphChanged(fn: () => void) {
  _graphChanged = fn;
}

/** Autosave plus a history entry, for an edit that changes no value (a Conduit's rotation). */
export function notifyGraphChanged(): void {
  _graphChanged();
}

let _bulkSettle: (renderOnly?: Set<string>) => Promise<void> = async (r) => { await processGraph(undefined, r); };

export function setBulkSettle(fn: (renderOnly?: Set<string>) => Promise<void>) {
  _bulkSettle = fn;
}

export function bulkSettle(renderOnly?: Set<string>) {
  return _bulkSettle(renderOnly);
}

export function markBulkTopoDirty() { markTopoDirty(); }

// Never nest: the topology-dirty flag is a single global.
export async function withGraphRebuild<T>(fn: () => Promise<T>): Promise<T> {
  openRebuildScope();
  try {
    return await fn();
  } finally {
    const [ended, dirty] = closeRebuildScope();
    if (ended) rebuildEnded();
    if (dirty) await bulkSettle();
  }
}

let _pgCount = 0;

let _settleWaiters: Array<() => void> = [];

/** Resolves once no pass is running and no rerun is queued, so a caller that just asked for a pass reads its result. */
export function graphSettled(): Promise<void> {
  if (!session().passActive) return Promise.resolve();
  return new Promise((resolve) => { _settleWaiters.push(resolve); });
}

export async function processGraph(changedNodeId?: string, renderOnly?: Set<string>, opts?: { force?: boolean; topology?: boolean }) {
  // Before the gate and single flight: a pass manual mode drops or a rerun coalesces still knows the node changed.
  if (changedNodeId) _editor?.named(changedNodeId);
  const entry = calcModeStore.track(() => enterPass(changedNodeId, opts?.force === true));
  // The edit that asked for this pass still changed the document, so it saves now rather than at the next F9.
  if (entry === "gated") { _graphChanged(); return; }
  if (entry === "queued") return;
  beginCompute();
  let finished = false;
  let rerun = null;
  try {
    await runGraphPass(changedNodeId, renderOnly, opts?.topology === true);
    finished = true;
  } finally {
    rerun = calcModeStore.track(() => exitPass(finished));
    endCompute();
  }
  if (rerun) {
    // The full rerun has no changed node to retarget, so a coalesced composite-internal edit marks its chain here.
    if (_editor && _engine) for (const id of rerun.changed) if (!_editor.getNode(id)) _engine.markNested(id);
    if (rerun.exact) calcModeStore.beginForceExact();
    try {
      await processGraph(undefined, undefined, rerun.force ? { force: true } : undefined);
    } finally {
      if (rerun.exact) calcModeStore.endForceExact();
    }
  }
  if (!session().passActive && _settleWaiters.length) {
    const waiters = _settleWaiters;
    _settleWaiters = [];
    for (const w of waiters) w();
  }
}

async function runGraphPass(changedNodeId?: string, renderOnly?: Set<string>, topologyChanged = false) {
  if (!_editor || !_engine || !_view) return;
  clearCollectMemo();
  // Before the engine pull: MathFn.data() reads the resolved angle mode.
  resolveTrigModes(_editor);
  const perf = perfEnabled();
  if (perf) beginPass();
  const ipc0 = perf ? ipcSnapshot() : null;
  const t0 = perf ? performance.now() : 0;
  cableValueStore.readFrom(_engine);
  const toRender = await _engine.pass(changedNodeId, renderOnly, topologyChanged);
  if (!toRender) return;
  const t1 = perf ? performance.now() : 0;
  cableValueStore.bump();
  await Promise.all(toRender.map((id) => _view!.rerenderNode(id)));
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
      `${renderOnly ? `additive rendered=${toRender.length}  ` : changedNodeId ? `targeted=${changedNodeId} rendered=${toRender.length}  ` : "FULL  "}` +
      `compute=${(t1 - t0).toFixed(1)}ms  render=${(t2 - t1).toFixed(1)}ms  total=${(t2 - t0).toFixed(1)}ms  ` +
      `ipc=${ipcCalls}call/${ipcMs.toFixed(1)}ms${top ? `  slowest: ${top}` : ""}`,
    );
  }
  compositePassStore.notify();
  _graphChanged();
}
