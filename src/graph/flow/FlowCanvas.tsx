// THE app canvas: one editor/engine/view stack lives for the app's lifetime;
// documents load through the REAL persistence/documentStore path; chrome talks
// to it through the process.ts slots. The surface itself (RF element, gestures,
// menus, keyboard) is FlowSurface, shared with the composite drill-in.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode } from "../schemes";
import { FlowSurfaceContext } from "../flowSurface";
import { cableSelectionStore } from "../cableState";
import { deleteSelection } from "../canvasActions";
import { makeFlowView, type FlowView } from "./flowView";
import { FlowSurface, idleHandlers, type SurfaceHandlers, type SurfaceHooks } from "./FlowSurface";
import { setEditorRefs, setGraphChanged, processGraph, setBulkSettle, markBulkTopoDirty, isGraphRebuilding } from "../process";
import { setUnselectAllNodes, setSelectNode, setDeleteSelected, setClearHistory, setAutoArrange, setCleanup, setRepositionDocked } from "../canvasCommands";
import { markGraphCustom } from "../seedStore";
import { bumpConnectionVersion } from "../graphSignals";
import { setCtorRegistryProvider } from "../ctorProvider";
import { flowHistory } from "./flowHistory";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { scheduleAutosave } from "../persistence";
import { documentStore, ensureFirstDocument } from "../documentStore";
import { paletteStore } from "../paletteStore";
import { CommandPalette } from "../CommandPalette";
import { CableFlourish } from "../components/CableFlourish";
import { SocketLegend, ConfirmDialog, NoticeToasts } from "../components";
import { makeEnsureElk, makeArrangeFn, makeCleanupFn } from "../tidyArrange";
import { reconcileFcTypes } from "../fcReconcile";
import { syncGroupCollapse } from "../groupCollapse";
import { FormatControllerNode, GroupNode } from "../rete-nodes";
import { formatAnnotationStore, formatMismatchStore, unitsCompatible } from "../formatAnnotationStore";
import { standoffStore, setStandoffSettle, type SettleOpts } from "../standoffs";
import { solveStandoffs } from "../standoffSolver";
import { withLockedGroupsPinned } from "../groupLogic";
import { measuredBox } from "../nodeSize";
import { translateEntityBy } from "../groupPush";
import { computeDockedCanvasPos, dockedRenderedDims } from "../fcDocking";
import { forgetNode } from "../nodeStoreRegistry";
import { rebuildGroupMembership } from "../groupMembership";
import { restoreSettledPushes } from "../groupPush";
import { dockedNodeStore } from "../dockedNodeStore";
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
  cablePipeInstalled?: boolean;
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
  // Topology changes from ANY writer (loadGraph, components' own drops,
  // canvas verbs) reach RF state through one coalesced editor watch. A REBUILD
  // (load, undo) yields the microtask queue between every addNode, so a
  // per-microtask sync would commit the whole canvas once PER NODE — O(n²)
  // React work (measured: 113s for one undo on a 241-node doc). While the
  // rebuild gate is held the queued sync just re-arms until the gate drops,
  // so a load settles in ONE commit.
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
  _stack = { editor, engine, view, handlers, docInit: false };
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
    markGraphCustom();
    scheduleAutosave();
    flowHistory.schedule();
  },
  // Position-only changes (nudge, group push, standoffs) never run
  // processGraph, so they record here; load/undo rebuilds are guarded out.
  afterProgrammaticMove: () => flowHistory.schedule(),
  afterNodeAdded: async (nodeId) => {
    await processGraph(nodeId, undefined, { topology: true });
    markGraphCustom();
    scheduleAutosave();
  },
  afterConnect: () => markGraphCustom(),
  standoffs: true,
  drawnCables: true,
  standsDownWhenDrilled: true,
};

function FlowCanvasInner() {
  const s = useMemo(getStack, []);

  // Chrome contract (process.ts slots) + the document lifecycle, once.
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
    // The single delete verb (RF's own deleteKeyCode is off so there is exactly one
    // path): deleteSelection gates the removal — ungated per-cable removes fire
    // un-awaited targeted passes that were still fetching a node the engine had just
    // dropped ("node is not initialized" on Host → FC → FC, delete the middle) — and
    // splices the ghost cable / Conduit lanes.
    setDeleteSelected(async () => {
      const doomed = s.editor.getNodes().some((n) => (n as { selected?: boolean }).selected);
      if (!doomed && cableSelectionStore.ids().length === 0 && !standoffStore.selected()) return;
      await deleteSelection(s.editor, s.view);
      markGraphCustom();
      scheduleAutosave();
    });

    // Docked FCs ride their host, driven through the view adapter.
    const repositionDockedTo = (hostId: string) => {
      const el = s.handlers.getContainer();
      if (!el) return;
      for (const rel of dockedNodeStore.getDockedTo(hostId)) {
        const dockedNode = s.editor.getNode(rel.id);
        if (!dockedNode) continue;
        if ((dockedNode as { selected?: boolean }).selected) continue;
        const { w, h } = dockedRenderedDims(s.view, rel.id, dockedNode.width, dockedNode.height);
        const pos = computeDockedCanvasPos(s.view, el, rel.hostNodeId, rel.socketKey, rel.side, w, h);
        if (pos) void s.view.moveNode(rel.id, pos);
      }
    };
    setRepositionDocked(repositionDockedTo);

    // Tidy + Cleanup; the auto-arrange plugin resolves view/editor through the
    // adapter's scope shims (see flowView.ts).
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

    // FC ↔ neighbor unit-mismatch badges — rescanned on every cable change and
    // annotation edit.
    const rescanMismatches = () => {
      for (const n of s.editor.getNodes()) {
        if (!(n instanceof FormatControllerNode)) continue;
        const mine = n.annotatedSocket();
        if (!mine) { formatMismatchStore.setMismatch(n.id, false); continue; }
        const myAnn = formatAnnotationStore.get(mine.nodeId, mine.socketKey);
        if (!myAnn || myAnn.unit === "none") { formatMismatchStore.setMismatch(n.id, false); continue; }
        let hasMismatch = false;
        for (const conn of s.editor.getConnections()) {
          const srcKey = `${conn.source}::${conn.sourceOutput}`;
          const tgtKey = `${conn.target}::${conn.targetInput}`;
          const myKey = `${mine.nodeId}::${mine.socketKey}`;
          const other = srcKey === myKey ? tgtKey : tgtKey === myKey ? srcKey : null;
          if (!other) continue;
          const sep = other.lastIndexOf("::");
          const otherAnn = formatAnnotationStore.get(other.slice(0, sep), other.slice(sep + 2));
          if (otherAnn && !unitsCompatible(myAnn.unit, otherAnn.unit)) { hasMismatch = true; break; }
        }
        formatMismatchStore.setMismatch(n.id, hasMismatch);
      }
    };
    const unsubFmt = formatAnnotationStore.subscribe(rescanMismatches);

    // The ONE settle after a bulk topology change (paste, unpack, load-adjacent
    // sweeps).
    setBulkSettle(async (renderOnly?: Set<string>) => {
      reconcileFcTypes(s.editor, s.view);
      bumpConnectionVersion();
      rescanMismatches();
      await processGraph(undefined, renderOnly);
      syncGroupCollapse(s.editor, s.view);
    });

    // Standoff network: the pure solver applied through the adapter. Registered
    // as the settle slot (keyboard rotate, canvasActions) and driven on drags.
    let standoffSolving = false;
    const settleStandoffNetwork = (pinned: Set<string> = new Set(), opts?: SettleOpts) => {
      if (standoffSolving || standoffStore.isEmpty()) return;
      const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const st of standoffStore.all()) {
        for (const end of [st.a, st.b]) {
          if (boxes.has(end.nodeId)) continue;
          const b = measuredBox(s.view, end.nodeId, s.editor);
          if (b) boxes.set(end.nodeId, { x: b.x, y: b.y, w: b.w, h: b.h });
        }
      }
      // A position-locked group holds against the band too — pin it in the solve.
      const disp = solveStandoffs(boxes, standoffStore.all(), withLockedGroupsPinned(s.editor, pinned), opts);
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

    // Every LIVE cable change — including ones components make themselves —
    // settles: FC retype reconcile, mismatch rescan, targeted recompute.
    // Installed once for the app-lifetime stack.
    if (!s.cablePipeInstalled) {
      s.cablePipeInstalled = true;
      s.editor.addPipe((ctx) => {
        const t = (ctx as { type?: string }).type;
        if (t === "noderemoved" && !isGraphRebuilding()) {
          // Live deletion: per-node store state must go (a rebuild runs
          // forgetAllNodes once instead), membership/collapse re-derive, and
          // deleting an expanded group settles the pushes it caused.
          const n = (ctx as unknown as { data: SolenoidNode }).data;
          forgetNode(n.id);
          rebuildGroupMembership(s.editor);
          syncGroupCollapse(s.editor, s.view);
          if (n instanceof GroupNode) restoreSettledPushes(s.editor, s.view);
        }
        if (t === "connectioncreated" || t === "connectionremoved") {
          if (!isGraphRebuilding()) {
            reconcileFcTypes(s.editor, s.view);
            bumpConnectionVersion();
            rescanMismatches();
            const cable = (ctx as unknown as { data: { source?: string; target?: string } }).data;
            if (cable.target && s.editor.getNode(cable.target)) {
              void processGraph(cable.target, undefined, { topology: true });
              if (cable.source && s.editor.getNode(cable.source)) void s.view.rerenderNode(cable.source);
            } else {
              void processGraph(undefined, undefined, { topology: true });
            }
            syncGroupCollapse(s.editor, s.view);
          } else {
            markBulkTopoDirty();
          }
        }
        return ctx;
      });
    }

    if (!s.docInit) {
      s.docInit = true;
      // Component-internal edits reach us here (processGraph's graphChanged);
      // each settled change autosaves AND records an undo step.
      setGraphChanged(() => {
        scheduleAutosave();
        flowHistory.schedule();
      });
      // Drawn-cable edits never run processGraph, so they record the same way here.
      setDrawnCommit(() => {
        scheduleAutosave();
        flowHistory.schedule();
      });
      // loadGraph clears history at the end of every document load — for the
      // snapshot history that IS the new document's baseline.
      setClearHistory(() => flowHistory.reset());
      void (async () => {
        if (!(await documentStore.restore())) await ensureFirstDocument();
      })();
    }
    return () => unsubFmt();
  }, [s]);

  const paletteOpen = useSyncExternalStore(paletteStore.subscribe, paletteStore.get);
  const paletteAlwaysOnSetting = useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.get("commandPaletteAlwaysOn"),
  );
  const paletteAlwaysOn = Boolean(paletteAlwaysOnSetting) && !IS_MOBILE;

  // The app chrome renders BESIDE the surface, not inside it: the main wrapper is
  // visibility:hidden under a drill-in, and toasts / dialogs / the palette must
  // stay visible there.
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
