// [[B10]] reactFlowView, [[C43]] oneFlowSurface, [[C33]] saveBindsMain, [[C40]] storesRegisterForget, [[C89]] standoffsSolveLast, [[D63]] lockedGroupIsObstacle
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode } from "../schemes";
import { FlowSurfaceContext } from "../flowSurface";
import { cableSelectionStore } from "../cableState";
import { deleteSelection, settleNodeRemoved } from "../canvasActions";
import { makeFlowView, type FlowView } from "./flowView";
import { FlowSurface, idleHandlers, type SurfaceHandlers, type SurfaceHooks } from "./FlowSurface";
import { setEditorRefs, setGraphChanged, processGraph, setBulkSettle, isGraphRebuilding } from "../process";
import { setUnselectAllNodes, setSelectNode, setDeleteSelected, setClearHistory, setAutoArrange, setCleanup, setRepositionDocked } from "../canvasCommands";
import { setCtorRegistryProvider } from "../ctorProvider";
import { flowHistory } from "./flowHistory";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { scheduleAutosave } from "../persistence";
import { documentStore, ensureFirstDocument } from "../documentStore";
import { SEEDS } from "../seeds";
import { paletteStore } from "../paletteStore";
import { CommandPalette } from "../CommandPalette";
import { CableFlourish } from "../components/CableFlourish";
import { SocketLegend, ConfirmDialog, NoticeToasts } from "../components";
import { makeEnsureElk, makeArrangeFn, makeCleanupFn } from "../tidyArrange";
import { settleCableChange } from "../cableSettle";
import { groupCollapseStore } from "../groupCollapse";
import { standoffStore, setStandoffSettle, liveStandoffs, type SettleOpts } from "../standoffs";
import { solveStandoffs } from "../standoffSolver";
import { withLockedGroupsPinned } from "../groupLogic";
import { measuredBox } from "../nodeSize";
import { translateEntityBy } from "../groupPush";
import { repositionDockedFor } from "../fcDocking";
import { setDrawnCommit } from "../drawnCables";
import { LoadOverlay } from "../components/LoadOverlay";
import { ComputeOverlay } from "../components/ComputeOverlay";
import { IsolatePill } from "../components/IsolatePill";
import { settingsStore } from "../settingsStore";
import { IS_MOBILE } from "../coarse";

type Stack = {
  editor: NodeEditor<Schemes>;
  engine: DataflowEngine<Schemes>;
  view: FlowView;
  handlers: SurfaceHandlers;
  docInit: boolean;
  nodePipeInstalled?: boolean;
  afterCableChange: (cable: { source?: string; target?: string }) => void;
  standoffSettle?: (pinned?: Set<string>, opts?: SettleOpts) => void;
};

let _stack: Stack | null = null;
function getStack(): Stack {
  if (_stack) return _stack;
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const handlers = idleHandlers();
  const view = makeFlowView(editor, {
    bumpNode: (id) => handlers.bumpNode(id),
    bumpConnections: () => handlers.bumpConnections(),
    moveNode: (id, pos) => handlers.moveNode(id, pos),
    setViewport: (v) => handlers.setViewport(v),
    getContainer: () => handlers.getContainer(),
  });
  let queued = false;
  const trySync = () => {
    if (isGraphRebuilding()) {
      setTimeout(trySync, 0);
      return;
    }
    queued = false;
    handlers.syncTopology();
  };
  editor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (
      t === "nodecreated" || t === "noderemoved" ||
      t === "connectioncreated" || t === "connectionremoved"
    ) {
      if (!queued) {
        queued = true;
        queueMicrotask(trySync);
      }
    }
    return ctx;
  });
  setEditorRefs(editor, engine, view);
  setCtorRegistryProvider(ctorRegistry);
  const afterCableChange = (cable: { source?: string; target?: string }) => {
    if (cable.target && editor.getNode(cable.target)) {
      void processGraph(cable.target, undefined, { topology: true });
      if (cable.source && editor.getNode(cable.source)) void view.rerenderNode(cable.source);
    } else {
      void processGraph(undefined, undefined, { topology: true });
    }
  };
  _stack = { editor, engine, view, handlers, docInit: false, afterCableChange };
  return _stack;
}

const MAIN_HOOKS: SurfaceHooks = {
  rfId: "main",
  history: { undo: () => flowHistory.undo(), redo: () => flowHistory.redo() },
  deleteSelected: async () => {
    const { deleteSelected } = await import("../canvasCommands");
    await deleteSelected();
  },
  afterMove: () => {
    scheduleAutosave();
    flowHistory.schedule();
  },
  // Position-only changes (nudge, group push, standoffs) never run processGraph, so they record here.
  afterProgrammaticMove: () => flowHistory.schedule(),
  afterNodeAdded: async (nodeId) => {
    await processGraph(nodeId, undefined, { topology: true });
    scheduleAutosave();
  },
  standoffs: true,
  drawnCables: true,
  standsDownWhenDrilled: true,
};

function FlowCanvasInner() {
  const s = useMemo(getStack, []);

  useEffect(() => {
    setUnselectAllNodes(() => {
      for (const n of s.editor.getNodes()) (n as { selected?: boolean }).selected = false;
      s.handlers.syncSelection();
    });
    setSelectNode((id, accumulate) => {
      for (const n of s.editor.getNodes()) {
        const sel = n.id === id || (accumulate && (n as { selected?: boolean }).selected === true);
        (n as { selected?: boolean }).selected = sel;
      }
      s.handlers.syncSelection();
    });
    setDeleteSelected(async () => {
      const doomed = s.editor.getNodes().some((n) => (n as { selected?: boolean }).selected);
      if (!doomed && cableSelectionStore.ids().length === 0 && !standoffStore.selected()) return;
      await deleteSelection(s.editor, s.view);
      scheduleAutosave();
    });

    const repositionDockedTo = (hostId: string) =>
      repositionDockedFor(s.editor, s.view, s.handlers.getContainer(), hostId);
    setRepositionDocked(repositionDockedTo);

    const ensureElk = makeEnsureElk(() => false);
    const arrangeFn = makeArrangeFn({
      editor: s.editor,
      view: s.view,
      container: s.handlers.getContainer() ?? document.body,
      ensureElk,
      repositionDockedTo,
      isDestroyed: () => false,
    });
    setAutoArrange(arrangeFn);
    setCleanup(makeCleanupFn(s.editor, s.view, arrangeFn));

    setBulkSettle(async (renderOnly?: Set<string>) => {
      settleCableChange(s.editor, s.view);
      await processGraph(undefined, renderOnly);
    });

    let standoffSolving = false;
    const settleStandoffNetwork = (pinned: Set<string> = new Set(), opts?: SettleOpts) => {
      if (standoffSolving || standoffStore.isEmpty()) return;
      const live = liveStandoffs(groupCollapseStore.isNodeHidden);
      const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const st of live) {
        for (const end of [st.a, st.b]) {
          if (boxes.has(end.nodeId)) continue;
          const b = measuredBox(s.view, end.nodeId, s.editor);
          if (b) boxes.set(end.nodeId, { x: b.x, y: b.y, w: b.w, h: b.h });
        }
      }
      const disp = solveStandoffs(boxes, live, withLockedGroupsPinned(s.editor, pinned), opts);
      if (disp.size === 0) return;
      standoffSolving = true;
      try {
        for (const [id, d] of disp) translateEntityBy(s.editor, s.view, id, d.dx, d.dy);
      } finally {
        standoffSolving = false;
      }
    };
    setStandoffSettle(settleStandoffNetwork);
    s.standoffSettle = settleStandoffNetwork;

    if (!s.nodePipeInstalled) {
      s.nodePipeInstalled = true;
      s.editor.addPipe((ctx) => {
        const t = (ctx as { type?: string }).type;
        if (t === "noderemoved") {
          settleNodeRemoved(s.editor, s.view, (ctx as unknown as { data: SolenoidNode }).data, isGraphRebuilding());
        }
        return ctx;
      });
    }

    if (!s.docInit) {
      s.docInit = true;
      setGraphChanged(() => {
        scheduleAutosave();
        flowHistory.schedule();
      });
      setDrawnCommit(() => {
        scheduleAutosave();
        flowHistory.schedule();
      });
      setClearHistory(() => flowHistory.reset());
      void (async () => {
        const restored = await documentStore.restore();
        const seedId = new URLSearchParams(window.location.search).get("seed");
        if (seedId && SEEDS[seedId]) {
          await documentStore.newFromTemplate(seedId);
          window.history.replaceState({}, "", window.location.pathname);
        } else if (!restored) {
          await ensureFirstDocument();
        }
      })();
    }
  }, [s]);

  const paletteOpen = useSyncExternalStore(paletteStore.subscribe, paletteStore.get);
  const paletteAlwaysOnSetting = useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.get("commandPaletteAlwaysOn"),
  );
  const paletteAlwaysOn = Boolean(paletteAlwaysOnSetting) && !IS_MOBILE;

  // App chrome renders beside the surface, because the main wrapper is visibility:hidden under a drill-in.
  return (
    <>
      <FlowSurface stack={s} hooks={MAIN_HOOKS} />
      {(paletteOpen || paletteAlwaysOn) && (
        <CommandPalette persistent={paletteAlwaysOn} onClose={() => paletteStore.close()} />
      )}
      <SocketLegend />
      <IsolatePill />
      <CableFlourish />
      <ConfirmDialog />
      <NoticeToasts />
      <LoadOverlay />
      <ComputeOverlay />
    </>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      {/* Node components under this provider render RF Handles. */}
      <FlowSurfaceContext.Provider value={true}>
        <FlowCanvasInner />
      </FlowSurfaceContext.Provider>
    </ReactFlowProvider>
  );
}
