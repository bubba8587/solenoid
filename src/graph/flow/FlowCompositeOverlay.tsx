// [[C43]] oneFlowSurface, [[C77]] compositeIsSubgraph, [[C33]] saveBindsMain
import type { View } from "../view";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { FlowSurfaceContext } from "../flowSurface";
import { FlowSurface, type SurfaceHooks } from "./FlowSurface";
import { getDrillStack, recordNow, scheduleRecord, syncPositionsToComp } from "./drillStack";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "../rete-nodes";
import type { SolenoidNode } from "../schemes";
import { compositeEditorStore, compositePassStore } from "../compositeEditorStore";
import { getEditor, getView, processGraph } from "../process";
import { swapSelectionSlots, swapArrangeSlots, swapDeleteSlot, swapRepositionDockedSlot } from "../canvasCommands";
import { repositionDockedFor } from "../fcDocking";
import { setActiveGraph } from "../activeGraph";
import { syncSemanticZoomFor } from "../semanticZoomStore";
import { scheduleAutosave } from "../persistence";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { deleteSelection as deleteSelectionIn } from "../canvasActions";
import { isolateStore } from "../isolateStore";
import { pushNotice } from "../noticeStore";
import { reconcileLeftPorts } from "../compositeLogic";
import { makeEnsureElk, makeArrangeFn, makeCleanupFn } from "../tidyArrange";
import { rebuildGroupMembership } from "../groupMembership";
import { syncGroupCollapse } from "../groupCollapse";
import { CompositeRunControls, RUN_MODE_OPTIONS } from "../components/CompositeNode";
import { IS_MOBILE } from "../coarse";
import "../components/compositeEditor.css";

const isBoundaryMarker = (n: object) => n instanceof CompositeInputNode || n instanceof CompositeOutputNode;

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

  const tidyRef = useRef<(opts?: { groupId?: string }) => Promise<void>>(async () => {});

  useEffect(() => {
    let canceled = false;
    let restoreSelection: (() => void) | null = null;
    let restoreArrange: (() => void) | null = null;
    let restoreDelete: (() => void) | null = null;
    let restoreReposition: (() => void) | null = null;
    s.open = true;
    s.rebuilding = true;
    void (async () => {
      await comp.hydrate(ctorRegistry());
      if (canceled) return;
      let fallback = 0;
      for (const n of comp.internalEditor.getNodes()) {
        const pos = comp.internalPositions[n.id]
          ?? { x: (fallback % 4) * 260, y: Math.floor(fallback / 4) * 160 };
        fallback++;
        n.position = { ...pos };
      }
      s.rebuilding = false;
      rebuildGroupMembership(comp.internalEditor);
      syncGroupCollapse(comp.internalEditor, s.view as unknown as View);
      s.handlers.syncTopology();
      setReady(true);
      setActiveGraph({
        editor: comp.internalEditor,
        view: s.view as unknown as View,
        scope: s.scope,
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
      restoreDelete = swapDeleteSlot(() => deleteSelection());
      restoreReposition = swapRepositionDockedSlot(repositionDockedTo);
      // Also catches edits made while closed, which no pipe recorded; an unchanged level records nothing.
      recordNow(comp, s);
    })();
    return () => {
      canceled = true;
      restoreSelection?.();
      restoreArrange?.();
      restoreDelete?.();
      restoreReposition?.();
      isolateStore.exit();
      setActiveGraph(null);
      syncPositionsToComp(comp, s);
      s.open = false;
      const mainView = getView();
      if (mainView) syncSemanticZoomFor(mainView.transform.k);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp, s]);

  useEffect(() => {
    let lastRunSeq = -1;
    return compositePassStore.subscribe(() => {
      if (comp.runSeq === lastRunSeq) return;
      lastRunSeq = comp.runSeq;
      s.handlers.bumpAllNodes();
      scheduleRecord(comp, s);
    });
  }, [comp, s]);

  // Every level the jump leaves reconciles its ports, not just the one on screen.
  const leaveLevels = useCallback(async (to: number) => {
    if (s.history.timer) recordNow(comp, s);
    syncPositionsToComp(comp, s);
    const st = compositeEditorStore.stack();
    for (let i = st.length - 1; i > to; i--) {
      const level = st[i];
      const parent = i > 0 ? st[i - 1].internalEditor : getEditor();
      if (!parent) { level.syncPortLabels(); continue; }
      const dropped = await reconcileLeftPorts(level, parent);
      if (dropped.cables > 0) {
        const name = level.label?.trim() || "Composite";
        pushNotice(
          `Removed ${dropped.cables} cable${dropped.cables === 1 ? "" : "s"} connected to ${name}; ${dropped.ports === 1 ? "a port was" : `${dropped.ports} ports were`} deleted inside.`,
          "warn",
        );
      }
    }
  }, [comp, s]);

  const settleAfterLeave = useCallback(async () => {
    if (parentEditor === getEditor()) {
      const outerView = getView();
      if (outerView) await outerView.rerenderNode(comp.id);
    }
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }, [comp, parentEditor, recomputeTarget]);

  const drillTo = useCallback(
    async (i: number) => {
      await leaveLevels(i);
      compositeEditorStore.backTo(i);
      await settleAfterLeave();
    },
    [leaveLevels, settleAfterLeave],
  );

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
    await s.view.moveNode(marker.id, pos);
    if (kind === "input") {
      comp.addInputPort({ label, internalNodeId: marker.id, exposure: "exposed", tier: "basic" });
    } else {
      comp.addOutputPort({ label, internalNodeId: marker.id, tier: "basic" });
    }
    if (parentEditor === getEditor()) {
      const outerView = getView();
      if (outerView) await outerView.rerenderNode(comp.id);
    }
    void processGraph(recomputeTarget());
    scheduleAutosave();
  }

  const deleteSelection = useCallback(
    () => deleteSelectionIn(comp.internalEditor, s.view as unknown as View, { ...s.scope, mainLayers: false, keeps: isBoundaryMarker }),
    [comp, s],
  );

  const historyStep = useCallback(
    async (redo: boolean) => {
      // One restore at a time.
      if (s.rebuilding) return;
      const h = s.history;
      if (h.timer) recordNow(comp, s);
      const target = redo ? h.index + 1 : h.index - 1;
      if (target < 0 || target >= h.stack.length) return;
      h.index = target;
      s.rebuilding = true;
      try {
        await comp.restoreInternal(JSON.parse(h.stack[target]), ctorRegistry());
        for (const [id, pos] of Object.entries(comp.internalPositions)) {
          const n = s.editor.getNode(id);
          if (n) n.position = { ...pos };
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

  const repositionDockedTo = useCallback(
    (hostId: string) => repositionDockedFor(comp.internalEditor, s.view as unknown as View, s.handlers.getContainer(), hostId),
    [comp, s],
  );
  const arrange = useMemo(() => {
    const ensureElk = makeEnsureElk(() => false);
    const arrangeFn = makeArrangeFn({
      editor: comp.internalEditor,
      view: s.view as unknown as View,
      container: s.handlers.getContainer() ?? document.body,
      ensureElk,
      repositionDockedTo,
      isDestroyed: () => false,
    });
    return { tidy: arrangeFn, cleanup: makeCleanupFn(comp.internalEditor, s.view as unknown as View, arrangeFn) };
  }, [comp, s, repositionDockedTo]);
  const settleArrange = useCallback((fit = true) => {
    if (fit) void fitView({ padding: 0.15, duration: 0 });
    void processGraph(recomputeTarget());
    scheduleAutosave();
    scheduleRecord(comp, s);
  }, [comp, s, fitView, recomputeTarget]);
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
