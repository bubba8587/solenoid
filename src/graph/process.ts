// [[B10]], [[D30]], [[D31]], [[D46]] freezeVolatilePerCalc (getRecalcGen)
import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { DataflowEngine } from "rete-engine";
import { cableValueStore } from "./cableValueStore";
import { loopMembers, seedLoopErrors, invalidate, fetchAll } from "./graphCompute";
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

export function getEngine() {
  return _engine;
}

let _rebuilding = 0;
export function beginGraphRebuild() { _rebuilding++; }
export function endGraphRebuild() { _rebuilding = Math.max(0, _rebuilding - 1); }
export function isGraphRebuilding() { return _rebuilding > 0; }

let _recalcGen = 0;

export function getRecalcGen() {
  return _recalcGen;
}

export async function requestRecalc() {
  _recalcGen++;
  calcModeStore.beginForceExact();
  try {
    await processGraph(undefined, undefined, { force: true });
  } finally {
    calcModeStore.endForceExact();
  }
}

// A registered hook, because importing persistence would cycle.
let _graphChanged: () => void = () => {};

export function setGraphChanged(fn: () => void) {
  _graphChanged = fn;
}

let _bulkSettle: (renderOnly?: Set<string>) => Promise<void> = async (r) => { await processGraph(undefined, r); };

export function setBulkSettle(fn: (renderOnly?: Set<string>) => Promise<void>) {
  _bulkSettle = fn;
}

export function bulkSettle(renderOnly?: Set<string>) {
  return _bulkSettle(renderOnly);
}

let _bulkTopoDirty = false;
export function markBulkTopoDirty() { _bulkTopoDirty = true; }

// Never nest: the topology-dirty flag is a single global.
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

let _pgCount = 0;

let _cachedLoop: Set<string> | null = null;

let _passActive = false;
let _rerunQueued = false;
let _rerunForce = false;
let _rerunExact = false;

export async function processGraph(changedNodeId?: string, renderOnly?: Set<string>, opts?: { force?: boolean; topology?: boolean }) {
  if (calcModeStore.isManual() && !opts?.force && !isGraphRebuilding()) {
    calcModeStore.markDirty();
    return;
  }
  if (_passActive) {
    _rerunQueued = true;
    _rerunForce ||= opts?.force === true;
    _rerunExact ||= calcModeStore.forcingExact();
    return;
  }
  _passActive = true;
  beginCompute();
  try {
    await runGraphPass(changedNodeId, renderOnly, opts?.topology === true);
    calcModeStore.clearDirty();
  } finally {
    _passActive = false;
    endCompute();
  }
  if (_rerunQueued) {
    const force = _rerunForce, exact = _rerunExact;
    _rerunQueued = false; _rerunForce = false; _rerunExact = false;
    if (exact) calcModeStore.beginForceExact();
    try {
      await processGraph(undefined, undefined, force ? { force } : undefined);
    } finally {
      if (exact) calcModeStore.endForceExact();
    }
  }
}

// Duck-typed on `internalEditor`: composite.ts imports this module, so importing it would cycle.
function findCompositeOwner(editor: NodeEditor<Schemes>, innerId: string): string | null {
  for (const n of editor.getNodes()) {
    const inner = (n as unknown as { internalEditor?: NodeEditor<Schemes> }).internalEditor;
    if (!inner) continue;
    if (inner.getNode(innerId) || findCompositeOwner(inner, innerId)) return n.id;
  }
  return null;
}

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
  if (changedNodeId && !_editor.getNode(changedNodeId)) {
    const owner = findCompositeOwner(_editor, changedNodeId);
    if (owner) {
      markInternalEditChain(_editor, changedNodeId);
      changedNodeId = owner;
    }
  }
  clearCollectMemo();
  // Before the engine pull: MathFn.data() reads the resolved angle mode.
  resolveTrigModes(_editor);
  const perf = perfEnabled();
  if (perf) beginPass();
  const ipc0 = perf ? ipcSnapshot() : null;
  const t0 = perf ? performance.now() : 0;
  const affected = invalidate(_editor, _engine, changedNodeId, !!renderOnly);

  // Seed before fetching: the engine resolves inputs before data(), so an unseeded loop never returns.
  // An additive pass follows a paste, which can bring its own loop, so only a value edit reuses the set.
  const loop = changedNodeId && !topologyChanged
    ? (_cachedLoop ?? (_cachedLoop = loopMembers(_editor)))
    : (_cachedLoop = loopMembers(_editor));
  seedLoopErrors(_editor, _engine, loop);

  const changedOut = affected ? new Set<string>() : null;
  const sinks = affected ? new Set<string>() : null;
  const values = await fetchAll(_editor, _engine, (id, outputs) => {
    if (changedOut) {
      const keys = Object.keys(outputs);
      if (keys.length === 0) sinks!.add(id);
      else if (keys.some((k) => cableValueStore.get(id, k) !== outputs[k])) changedOut.add(id); // must compare before setNodeOutputs overwrites
    }
    cableValueStore.setNodeOutputs(id, outputs);
  }, { stopOnCancel: true });
  if (!values) return;
  const t1 = perf ? performance.now() : 0;
  cableValueStore.bump();
  let toRender = _editor.getNodes();
  if (renderOnly) {
    toRender = toRender.filter((n) => renderOnly.has(n.id));
  } else if (affected) {
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
  compositePassStore.notify();
  _graphChanged();
}
