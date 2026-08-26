// The composite drill-in: a full-viewport FlowSurface over the composite's
// INTERNAL editor (the same surface as the main canvas), plus the one piece of
// drill-in-specific chrome (breadcrumb strip, port promotion, run controls) and
// a per-composite snapshot history. The level registers as the ACTIVE graph and
// takes over the selection / arrange verbs while open.
import type { Surface } from "../surface";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { FlowSurfaceContext } from "../flowSurface";
import { makeFlowArea, type FlowArea } from "./flowArea";
import { FlowSurface, idleHandlers, type SurfaceHandlers, type SurfaceHooks } from "./FlowSurface";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "../rete-nodes";
import type { SolenoidNode } from "../schemes";
import { compositeEditorStore, compositePassStore } from "../compositeEditorStore";
import { getEditor, getArea, processGraph, swapSelectionSlots, swapArrangeSlots } from "../process";
import { setActiveGraph } from "../activeGraph";
import { syncSemanticZoomFor } from "../semanticZoomStore";
import { scheduleAutosave } from "../persistence";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { cableSelectionStore } from "../cableState";
import { isolateStore } from "../isolateStore";
import { pushNotice } from "../noticeStore";
import { makeEnsureElk, makeArrangeFn, makeCleanupFn } from "../tidyArrange";
import { CompositeRunControls, RUN_MODE_OPTIONS } from "../components/CompositeNode";
import { IS_MOBILE } from "../coarse";
import "../components/compositeEditor.css";

const HISTORY_DEPTH = 50;
const HISTORY_COALESCE_MS = 400;

type DrillStack = {
  editor: CompositeNode["internalEditor"];
  engine: CompositeNode["internalEngine"];
  positions: Map<string, { x: number; y: number }>;
  area: FlowArea;
  handlers: SurfaceHandlers;
  /** True through hydrate/restore — the topology pipe waits it out (the same
   *  O(n²) trap the main canvas hit on loads). */
  rebuilding: boolean;
  isRebuilding: () => boolean;
  history: { stack: string[]; index: number; timer: ReturnType<typeof setTimeout> | null };
};

type DrillHolder = { __flowDrill?: DrillStack };

/** One stack per composite, cached on the node: the editor pipe can only
 *  install once, and the undo stack survives close/reopen. */
function getDrillStack(comp: CompositeNode): DrillStack {
  const holder = comp as unknown as DrillHolder;
  if (holder.__flowDrill) return holder.__flowDrill;
  const positions = new Map<string, { x: number; y: number }>();
  const handlers = idleHandlers();
  const area = makeFlowArea(comp.internalEditor, positions, {
    bumpNode: (id) => handlers.bumpNode(id),
    bumpConnections: () => handlers.bumpConnections(),
    moveNode: (id, pos) => handlers.moveNode(id, pos),
    setViewport: (v) => handlers.setViewport(v),
    getContainer: () => handlers.getContainer(),
  });
  const s: DrillStack = {
    editor: comp.internalEditor,
    engine: comp.internalEngine,
    positions,
    area,
    handlers,
    rebuilding: true,
    isRebuilding: () => s.rebuilding,
    history: { stack: [], index: -1, timer: null },
  };
  let queued = false;
  const trySync = () => {
    if (s.rebuilding) {
      setTimeout(trySync, 0);
      return;
    }
    queued = false;
    handlers.syncTopology();
    // Component-driven topology changes settle here: retarget the breadcrumb
    // root and persist.
    void processGraph(compositeEditorStore.stack()[0]?.id ?? comp.id);
    scheduleAutosave();
    scheduleRecord(comp, s);
  };
  comp.internalEditor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (
      t === "nodecreated" || t === "noderemoved" ||
      t === "connectioncreated" || t === "connectionremoved"
    ) {
      if (t === "noderemoved") {
        positions.delete((ctx as unknown as { data: { id: string } }).data.id);
      }
      if (!queued) {
        queued = true;
        queueMicrotask(trySync);
      }
    }
    return ctx;
  });
  holder.__flowDrill = s;
  return s;
}

function syncPositionsToComp(comp: CompositeNode, s: DrillStack) {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, view] of s.area.nodeViews) out[id] = { x: view.position.x, y: view.position.y };
  comp.internalPositions = out;
}

function recordNow(comp: CompositeNode, s: DrillStack) {
  if (s.rebuilding) return;
  if (s.history.timer) {
    clearTimeout(s.history.timer);
    s.history.timer = null;
  }
  syncPositionsToComp(comp, s);
  const json = JSON.stringify(comp.snapshotInternal());
  const h = s.history;
  if (json === h.stack[h.index]) return;
  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(json);
  if (h.stack.length > HISTORY_DEPTH) h.stack.shift();
  h.index = h.stack.length - 1;
}

function scheduleRecord(comp: CompositeNode, s: DrillStack) {
  if (s.rebuilding) return;
  if (s.history.timer) clearTimeout(s.history.timer);
  s.history.timer = setTimeout(() => {
    s.history.timer = null;
    recordNow(comp, s);
  }, HISTORY_COALESCE_MS);
}

function FlowDrillInner({ composite: comp }: { composite: CompositeNode }) {
  const s = useMemo(() => getDrillStack(comp), [comp]);
  const [ready, setReady] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(!IS_MOBILE);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useSyncExternalStore(compositePassStore.subscribe, compositePassStore.version);
  useSyncExternalStore(compositeEditorStore.subscribe, compositeEditorStore.version);
  const { fitView, screenToFlowPosition } = useReactFlow();

  const recomputeTarget = useCallback(
    () => compositeEditorStore.stack()[0]?.id ?? comp.id,
    [comp],
  );
  const parentEditor = (() => {
    const st = compositeEditorStore.stack();
    const i = st.indexOf(comp);
    return i > 0 ? st[i - 1].internalEditor : getEditor();
  })();

  // The top bar's Tidy / Cleanup reach this level through the arrange slots.
  const tidyRef = useRef<(opts?: { groupId?: string }) => Promise<void>>(async () => {});

  // Open: hydrate, seed positions, publish as the ACTIVE graph; the selection
  // and arrange verbs point here while open.
  useEffect(() => {
    let canceled = false;
    let restoreSelection: (() => void) | null = null;
    let restoreArrange: (() => void) | null = null;
    s.rebuilding = true;
    void (async () => {
      await comp.hydrate(ctorRegistry());
      if (canceled) return;
      let fallback = 0;
      for (const n of comp.internalEditor.getNodes()) {
        const pos = comp.internalPositions[n.id]
          ?? { x: (fallback % 4) * 260, y: Math.floor(fallback / 4) * 160 };
        fallback++;
        s.positions.set(n.id, { ...pos });
      }
      s.rebuilding = false;
      s.handlers.syncTopology();
      setReady(true);
      setActiveGraph({
        editor: comp.internalEditor,
        area: s.area as unknown as Surface,
      });
      restoreSelection = swapSelectionSlots({
        unselectAllNodes: () => {
          for (const n of comp.internalEditor.getNodes()) (n as { selected?: boolean }).selected = false;
          s.handlers.syncSelection();
        },
        selectNode: (id, accumulate) => {
          for (const n of comp.internalEditor.getNodes()) {
            const sel = n.id === id || (accumulate && (n as { selected?: boolean }).selected === true);
            (n as { selected?: boolean }).selected = sel;
          }
          s.handlers.syncSelection();
        },
      });
      restoreArrange = swapArrangeSlots({
        autoArrange: (opts) => tidyRef.current(opts),
        cleanup: () => cleanupRef.current(),
      });
      if (s.history.stack.length === 0) recordNow(comp, s);
    })();
    return () => {
      canceled = true;
      restoreSelection?.();
      restoreArrange?.();
      isolateStore.exit();
      setActiveGraph(null);
      syncPositionsToComp(comp, s);
      const mainArea = getArea();
      if (mainArea) syncSemanticZoomFor(mainArea.area.transform.k);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp, s]);

  // A completed pass that RAN this composite re-renders every internal card —
  // and records for undo: component-driven edits (an op pick, a label blur)
  // fire no editor event, but they all end in a retargeted pass. The restore
  // path's own pass records a no-op (JSON dedupe).
  useEffect(() => {
    let lastRunSeq = -1;
    return compositePassStore.subscribe(() => {
      if (comp.runSeq === lastRunSeq) return;
      lastRunSeq = comp.runSeq;
      s.handlers.bumpAllNodes();
      scheduleRecord(comp, s);
    });
  }, [comp, s]);

  /** Save positions + reconcile this level's ports against its PARENT graph. */
  const leaveLevel = useCallback(async () => {
    if (s.history.timer) recordNow(comp, s);
    syncPositionsToComp(comp, s);
    if (parentEditor) {
      let droppedCables = 0;
      let droppedPorts = 0;
      for (const p of [...comp.inputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        const cables = parentEditor.getConnections().filter((c) => c.target === comp.id && c.targetInput === p.id);
        for (const c of cables) await parentEditor.removeConnection(c.id);
        if (cables.length > 0) { droppedCables += cables.length; droppedPorts++; }
        comp.removeInputPort(p.id);
      }
      for (const p of [...comp.outputPorts]) {
        if (comp.internalEditor.getNode(p.internalNodeId)) continue;
        const cables = parentEditor.getConnections().filter((c) => c.source === comp.id && c.sourceOutput === p.id);
        for (const c of cables) await parentEditor.removeConnection(c.id);
        if (cables.length > 0) { droppedCables += cables.length; droppedPorts++; }
        comp.removeOutputPort(p.id);
      }
      if (droppedCables > 0) {
        const name = comp.label?.trim() || "Composite";
        pushNotice(
          `Removed ${droppedCables} cable${droppedCables === 1 ? "" : "s"} connected to ${name}; ${droppedPorts === 1 ? "a port was" : `${droppedPorts} ports were`} deleted inside.`,
          "warn",
        );
      }
    }
    comp.syncPortLabels();
  }, [comp, s, parentEditor]);

  const settleAfterLeave = useCallback(async () => {
    if (parentEditor === getEditor()) {
      const outerArea = getArea();
      if (outerArea) await outerArea.update("node", comp.id);
    }
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }, [comp, parentEditor, recomputeTarget]);

  const drillTo = useCallback(
    async (i: number) => {
      await leaveLevel();
      compositeEditorStore.backTo(i);
      await settleAfterLeave();
    },
    [leaveLevel, settleAfterLeave],
  );

  /** The promotion gesture: a fresh boundary marker + its exposed port. */
  async function addPort(kind: "input" | "output") {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const n = kind === "input" ? comp.inputPorts.length + 1 : comp.outputPorts.length + 1;
    const label = kind === "input" ? `Input ${n}` : `Output ${n}`;
    const marker = kind === "input" ? new CompositeInputNode({ label }) : new CompositeOutputNode({ label });
    await comp.internalEditor.addNode(marker as SolenoidNode);
    installErrorGuards(marker);
    const pos = screenToFlowPosition({
      x: kind === "input" ? rect.left + 80 : rect.right - 260,
      y: rect.top + rect.height / 2,
    });
    await s.area.translate(marker.id, pos);
    if (kind === "input") {
      comp.addInputPort({ label, internalNodeId: marker.id, exposure: "exposed", tier: "basic" });
    } else {
      comp.addOutputPort({ label, internalNodeId: marker.id, tier: "basic" });
    }
    if (parentEditor === getEditor()) {
      const outerArea = getArea();
      if (outerArea) await outerArea.update("node", comp.id);
    }
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  /** Delete the drill-in selection, cables first; boundary markers excluded. */
  const deleteSelection = useCallback(async () => {
    const editor = comp.internalEditor;
    for (const id of cableSelectionStore.ids()) {
      if (editor.getConnection(id)) await editor.removeConnection(id);
    }
    cableSelectionStore.clear();
    const selected = editor.getNodes().filter(
      (n) => (n as { selected?: boolean }).selected === true &&
        !(n instanceof CompositeInputNode) && !(n instanceof CompositeOutputNode),
    );
    for (const node of selected) {
      for (const c of editor.getConnections().filter((c) => c.source === node.id || c.target === node.id)) {
        await editor.removeConnection(c.id);
      }
      await editor.removeNode(node.id);
    }
  }, [comp]);

  /** Undo/redo over the per-composite snapshot stack. */
  const historyStep = useCallback(
    async (redo: boolean) => {
      const h = s.history;
      if (h.timer) recordNow(comp, s);
      const target = redo ? h.index + 1 : h.index - 1;
      if (target < 0 || target >= h.stack.length) return;
      h.index = target;
      s.rebuilding = true;
      try {
        await comp.restoreInternal(JSON.parse(h.stack[target]), ctorRegistry());
        s.positions.clear();
        for (const [id, pos] of Object.entries(comp.internalPositions)) {
          s.positions.set(id, { ...pos });
        }
      } finally {
        s.rebuilding = false;
      }
      s.handlers.syncTopology();
      void processGraph(recomputeTarget());
      scheduleAutosave();
    },
    [comp, s, recomputeTarget],
  );

  // The SAME arrange factory as the main canvas (groups as blocks, members re-placed,
  // docked FCs re-homed) over this level; a bare ELK pass moved group bodies without
  // their members.
  const arrange = useMemo(() => {
    const ensureElk = makeEnsureElk(() => false);
    const arrangeFn = makeArrangeFn({
      editor: comp.internalEditor,
      area: s.area as unknown as Surface,
      container: s.handlers.getContainer() ?? document.body,
      ensureElk,
      repositionDockedTo: () => {},
      isDestroyed: () => false,
    });
    return { tidy: arrangeFn, cleanup: makeCleanupFn(comp.internalEditor, s.area as unknown as Surface, arrangeFn) };
  }, [comp, s]);
  const settleArrange = useCallback((fit = true) => {
    if (fit) void fitView({ padding: 0.15, duration: 0 });
    void processGraph(recomputeTarget());
    scheduleAutosave();
    scheduleRecord(comp, s);
  }, [comp, s, fitView, recomputeTarget]);
  // A group-scoped tidy (the group header's Tidy) lays out just its members, no refit.
  const tidyDrill = useCallback(async (opts?: { groupId?: string }) => { await arrange.tidy(opts); settleArrange(!opts?.groupId); }, [arrange, settleArrange]);
  const cleanupDrill = useCallback(async () => { await arrange.cleanup(); settleArrange(); }, [arrange, settleArrange]);
  tidyRef.current = tidyDrill;
  const cleanupRef = useRef<() => Promise<void>>(async () => {});
  cleanupRef.current = cleanupDrill;

  const hooks: SurfaceHooks = {
    rfId: "drill",
    className: "solenoid-composite-editor__host",
    history: { undo: () => historyStep(false), redo: () => historyStep(true) },
    deleteSelected: deleteSelection,
    afterMove: () => { scheduleRecord(comp, s); scheduleAutosave(); },
    afterProgrammaticMove: () => scheduleRecord(comp, s),
    // The level's editor pipe already recomputes + persists a topology change.
    afterNodeAdded: () => scheduleAutosave(),
    fitViewOnInit: true,
    onEscape: () => void drillTo(compositeEditorStore.stack().length - 2),
  };

  return (
    <div className="solenoid-composite-editor__backdrop" ref={wrapperRef}>
      <FlowSurface stack={s} hooks={hooks}>
        {!ready && <div className="solenoid-composite-editor__loading" />}
      </FlowSurface>
      <div className="solenoid-composite-editor__strip" onPointerDown={(e) => e.stopPropagation()}>
        <div className="solenoid-composite-editor__crumbs">
          <button
            type="button"
            className="solenoid-composite-editor__crumb solenoid-composite-editor__crumb--root"
            title="Back to the canvas"
            onClick={() => void drillTo(-1)}
          >
            Canvas
          </button>
          {compositeEditorStore.stack().map((c, i, arr) => (
            <span key={c.id} className="solenoid-composite-editor__crumb-wrap">
              <span className="solenoid-composite-editor__crumb-sep">▸</span>
              {i === arr.length - 1 ? (
                <span className="solenoid-composite-editor__crumb solenoid-composite-editor__crumb--current" title="Editing this subgraph">
                  {c.label?.trim() || "Composite"}
                </span>
              ) : (
                <button
                  type="button"
                  className="solenoid-composite-editor__crumb"
                  title={`Drill up to ${c.label?.trim() || "Composite"}`}
                  onClick={() => void drillTo(i)}
                >
                  {c.label?.trim() || "Composite"}
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="solenoid-composite-editor__strip-actions">
          <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("input")}>
            + Input
          </button>
          <button type="button" className="solenoid-composite-editor__btn" onClick={() => void addPort("output")}>
            + Output
          </button>
        </div>
      </div>
      {(comp.inputPorts.length > 0 || comp.outputPorts.length > 0) && (
        <div
          className={`solenoid-composite-editor__controls${controlsOpen ? "" : " solenoid-composite-editor__controls--collapsed"}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="solenoid-composite-editor__controls-head"
            onClick={() => setControlsOpen((v) => !v)}
            title={controlsOpen ? "Hide run controls" : "Show run controls"}
            aria-expanded={controlsOpen}
          >
            <span className="solenoid-composite-editor__controls-title">
              {RUN_MODE_OPTIONS.find((o) => o.value === comp.runMode)?.label ?? "Run"}
            </span>
            <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
                 style={{ display: "block", flexShrink: 0, transform: controlsOpen ? "rotate(180deg)" : undefined }}>
              <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {controlsOpen && (
            <div className="solenoid-composite-editor__controls-body">
              <CompositeRunControls node={comp} insideOnly />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FlowCompositeOverlay() {
  useSyncExternalStore(compositeEditorStore.subscribe, compositeEditorStore.version);
  const current = compositeEditorStore.current();
  const open = !!current;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("sol-drilled-in", open);
    return () => root.classList.remove("sol-drilled-in");
  }, [open]);
  if (!current) return null;
  return (
    <ReactFlowProvider key={current.id}>
      <FlowSurfaceContext.Provider value={true}>
        <FlowDrillInner composite={current} />
      </FlowSurfaceContext.Provider>
    </ReactFlowProvider>
  );
}
