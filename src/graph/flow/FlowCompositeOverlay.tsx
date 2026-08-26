// The composite drill-in — the same RF machinery the main canvas runs:
// SolNodeAdapter cards, FlowCableEdge cables, the flowArea adapter registered
// as the ACTIVE graph, and a per-composite snapshot history over
// snapshotInternal().
import type { Surface } from "../surface";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type IsValidConnection,
  type Viewport,
} from "@xyflow/react";
import { FlowSurfaceContext } from "../flowSurface";
import { SolNodeAdapter } from "./SolNodeAdapter";
import { FlowCableEdge } from "./FlowCableEdge";
import { toFlowNodes, toFlowEdges, nodeClassName, type FlowModel } from "./flowModel";
import { installLassoSelection, type LassoState } from "../canvasLasso";
import { moveGroupMembers } from "../groupLogic";
import { groupCollapseStore } from "../groupCollapse";
import { socketHighlightStore, dragSocketKey } from "../cableState";
import { touchSelectStore } from "../touchSelectStore";
import { CableInspector } from "../components/CableInspector";
import { canConnect, connect } from "./flowController";
import { makeFlowArea, type FlowArea } from "./flowArea";
import { installFlowPinch } from "./flowPinch";
import { installTouchCardPan } from "./flowTouchPan";
import { installWheelZoom } from "./flowWheel";
import { CompositeNode, CompositeInputNode, CompositeOutputNode, GroupNode } from "../rete-nodes";
import type { SolenoidNode } from "../schemes";
import { compositeEditorStore, compositePassStore } from "../compositeEditorStore";
import { getEditor, getArea, processGraph, setCableDragging, swapSelectionSlots, swapArrangeSlots } from "../process";
import { setActiveGraph } from "../activeGraph";
import { syncSemanticZoomFor } from "../semanticZoomStore";
import { copySelected, pasteClipboard } from "../copyPaste";
import { scheduleAutosave } from "../persistence";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { cableSelectionStore } from "../cableState";
import { canvasLockStore } from "../canvasLock";
import { isolateStore } from "../isolateStore";
import { pushNotice } from "../noticeStore";
import { buildCatalog } from "../catalogUtils";
import { AddNodeMenu, type NodeCatalogEntry } from "../AddNodeMenu";
import { installCanvasKeyboard } from "../canvasKeyboard";
import { addMenuRequest } from "../addMenuStore";
import { paletteStore } from "../paletteStore";
import { frStore } from "../frStore";
import { settingsPanel } from "../settingsStore";
import { MIN_ZOOM, MAX_ZOOM } from "../areaPresets";
import { makeEnsureElk, elkTidyLayout, tidyOptionsFromSettings, type Elk } from "../tidyArrange";
import { CompositeRunControls, RUN_MODE_OPTIONS } from "../components/CompositeNode";
import { minimapFillForNode } from "../components/Minimap";
import { appThemeStore } from "../appTheme";
import { DrillNodeMenu } from "../components/DrillNodeMenu";
import { IS_MOBILE, IS_COARSE } from "../coarse";
import "../components/compositeEditor.css";

const nodeTypes = { sol: SolNodeAdapter };
const edgeTypes = { cable: FlowCableEdge };

const HISTORY_DEPTH = 50;
const HISTORY_COALESCE_MS = 400;

type DrillHandlers = {
  bumpNode(id: string): void;
  bumpConnections(): void;
  moveNode(id: string, pos: { x: number; y: number }): void;
  setViewport(v: Viewport): void;
  getContainer(): HTMLElement | null;
  syncTopology(): void;
};

type DrillStack = FlowModel & {
  area: FlowArea;
  handlers: DrillHandlers;
  /** True through hydrate/restore — the topology pipe waits it out (the same
   *  O(n²) trap the main canvas hit on loads). */
  rebuilding: boolean;
  history: { stack: string[]; index: number; timer: ReturnType<typeof setTimeout> | null };
};

type DrillHolder = { __flowDrill?: DrillStack };

/** One stack per composite, cached on the node (like the rete overlay's mount):
 *  the editor pipe can only install once, and the undo stack survives
 *  close/reopen. */
function getDrillStack(comp: CompositeNode): DrillStack {
  const holder = comp as unknown as DrillHolder;
  if (holder.__flowDrill) return holder.__flowDrill;
  const positions = new Map<string, { x: number; y: number }>();
  const handlers: DrillHandlers = {
    bumpNode: () => {},
    bumpConnections: () => {},
    moveNode: () => {},
    setViewport: () => {},
    getContainer: () => null,
    syncTopology: () => {},
  };
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
    // Component-driven topology changes settle like the rete overlay's pipe:
    // retarget the breadcrumb root and persist.
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
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState<{ screenX: number; screenY: number } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<
    { nodeId: string; screenX: number; screenY: number; isComposite: boolean } | null
  >(null);
  const [controlsOpen, setControlsOpen] = useState(!IS_MOBILE);
  const [lasso, setLasso] = useState<LassoState>(null);
  // The top bar's Tidy / Cleanup reach this level through the arrange slots.
  const tidyRef = useRef<() => Promise<void>>(async () => {});
  const touchSelect = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef({ x: 0, y: 0 });
  const pendingFitRef = useRef(false);
  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const themeMode = appThemeStore.getMode();
  useSyncExternalStore(compositePassStore.subscribe, compositePassStore.version);
  useSyncExternalStore(compositeEditorStore.subscribe, compositeEditorStore.version);
  const { setViewport, getViewport, screenToFlowPosition, fitView } = useReactFlow();

  const recomputeTarget = useCallback(
    () => compositeEditorStore.stack()[0]?.id ?? comp.id,
    [comp],
  );
  const parentEditor = (() => {
    const st = compositeEditorStore.stack();
    const i = st.indexOf(comp);
    return i > 0 ? st[i - 1].internalEditor : getEditor();
  })();

  const syncTopology = useCallback(() => {
    s.area.syncViews();
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return toFlowNodes(s).map((n) => {
        const old = prevById.get(n.id);
        if (
          old &&
          old.position.x === n.position.x &&
          old.position.y === n.position.y &&
          old.className === n.className
        ) {
          return old;
        }
        return {
          ...n,
          selected: old?.selected ?? false,
          data: { ...n.data, version: (old?.data.version as number) ?? 0 },
        };
      }) as unknown as Node[];
    });
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]));
      return toFlowEdges(s).map((e) => prevById.get(e.id) ?? e) as unknown as Edge[];
    });
  }, [s]);

  // Member hiding follows the collapse store LIVE (same channel as the main canvas).
  useEffect(
    () =>
      groupCollapseStore.subscribe(() => {
        setNodes((ns) => {
          let changed = false;
          const next = ns.map((n) => {
            const cls = nodeClassName(n.id);
            if ((n.className ?? undefined) === cls) return n;
            changed = true;
            return { ...n, className: cls };
          });
          return changed ? next : ns;
        });
      }),
    [],
  );

  // Late-bind the adapter handlers to this mount.
  useEffect(() => {
    s.handlers.bumpNode = (id) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, version: (n.data.version as number) + 1 } } : n,
        ),
      );
    s.handlers.bumpConnections = () => setEdges(toFlowEdges(s) as unknown as Edge[]);
    s.handlers.moveNode = (id, pos) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, position: { ...pos } } : n)));
      scheduleRecord(comp, s);
    };
    s.handlers.setViewport = (v) => {
      void setViewport(v);
      syncSemanticZoomFor(v.zoom);
    };
    s.handlers.getContainer = () => wrapperRef.current;
    s.handlers.syncTopology = syncTopology;
  }, [comp, s, setViewport, syncTopology]);

  // Open: hydrate, seed positions, publish as the ACTIVE graph. The selection verbs
  // (lasso, align bar, keyboard) point here while open.
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
      pendingFitRef.current = true;
      syncTopology();
      setReady(true);
      setActiveGraph({
        editor: comp.internalEditor,
        area: s.area as unknown as Surface,
      });
      restoreSelection = swapSelectionSlots({
        unselectAllNodes: () => {
          for (const n of comp.internalEditor.getNodes()) (n as { selected?: boolean }).selected = false;
          setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        },
        selectNode: (id, accumulate) => {
          for (const n of comp.internalEditor.getNodes()) {
            const sel = n.id === id || (accumulate && (n as { selected?: boolean }).selected === true);
            (n as { selected?: boolean }).selected = sel;
          }
          setNodes((ns) =>
            ns.map((n) => {
              const sel = n.id === id || (accumulate && n.selected === true);
              return sel === (n.selected ?? false) ? n : { ...n, selected: sel };
            }),
          );
        },
      });
      restoreArrange = swapArrangeSlots({
        autoArrange: () => tidyRef.current(),
        cleanup: () => tidyRef.current(),
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
      setNodes((ns) =>
        ns.map((n) => ({ ...n, data: { ...n.data, version: (n.data.version as number) + 1 } })),
      );
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
      syncTopology();
      void processGraph(recomputeTarget());
      scheduleAutosave();
    },
    [comp, s, syncTopology, recomputeTarget],
  );

  async function duplicateNode(nodeId: string) {
    const editor = comp.internalEditor;
    if (!editor.getNode(nodeId)) return;
    const snap = editor.getNodes().map((n) => [n, (n as { selected?: boolean }).selected] as const);
    for (const [n] of snap) (n as { selected?: boolean }).selected = n.id === nodeId;
    copySelected();
    for (const [n, sel] of snap) (n as { selected?: boolean }).selected = sel;
    const base = s.area.nodeViews.get(nodeId)?.position ?? { x: 0, y: 0 };
    await pasteClipboard(base.x, base.y);
    scheduleAutosave();
  }

  async function deleteNode(nodeId: string) {
    const editor = comp.internalEditor;
    const node = editor.getNode(nodeId);
    if (!node || node instanceof CompositeInputNode || node instanceof CompositeOutputNode) return;
    for (const c of editor.getConnections().filter((c) => c.source === nodeId || c.target === nodeId)) {
      await editor.removeConnection(c.id);
    }
    await editor.removeNode(nodeId);
  }

  const ensureElkRef = useRef<(() => Promise<Elk | null>) | null>(null);
  const tidyDrill = useCallback(async () => {
    if (!ensureElkRef.current) ensureElkRef.current = makeEnsureElk(() => false);
    const elk = await ensureElkRef.current();
    if (!elk) return;
    await elkTidyLayout(elk, {
      nodes: comp.internalEditor.getNodes(),
      connections: comp.internalEditor.getConnections(),
      options: tidyOptionsFromSettings(),
      translate: (id, x, y) => s.area.translate(id, { x, y }),
    });
    void fitView({ padding: 0.15, duration: 0 });
    void processGraph(recomputeTarget());
    scheduleAutosave();
    scheduleRecord(comp, s);
  }, [comp, s, fitView, recomputeTarget]);
  tidyRef.current = tidyDrill;

  // The full canvas keyboard over THIS level's refs (the main instance stands down);
  // the drill-in adds only Escape (close menu / leave isolate / drill up).
  const menuRef = useRef(menu);
  menuRef.current = menu;
  useEffect(() => {
    const unKeys = installCanvasKeyboard({
      editorRef: { current: comp.internalEditor },
      areaRef: { current: s.area as unknown as Surface },
      historyRef: { current: { undo: () => historyStep(false), redo: () => historyStep(true) } },
      containerRef: wrapperRef,
      screenMouseRef: cursorRef,
      isAddMenuOpen: () => menuRef.current !== null,
      deleteSelected: deleteSelection,
    });
    const unMenu = addMenuRequest.register((screenX, screenY) => setMenu({ screenX, screenY }));
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable) return;
      // An open overlay (palette, reference, settings) takes the Escape itself.
      if (paletteStore.get() || frStore.get() || settingsPanel.get()) return;
      if (menuRef.current) setMenu(null);
      else if (isolateStore.isActive()) isolateStore.exit();
      else void drillTo(compositeEditorStore.stack().length - 2);
    }
    const onMouseMove = (e: MouseEvent) => { cursorRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      unKeys();
      unMenu();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [comp, s, historyStep, deleteSelection, drillTo]);

  // Pinch/pan/wheel: the same installers as the main flow canvas.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const drive = (v: Viewport) => {
      void setViewport(v);
      s.area.setTransform({ x: v.x, y: v.y, k: v.zoom });
      syncSemanticZoomFor(v.zoom);
    };
    const unPinch = installFlowPinch(el, { getViewport, setViewport: drive });
    const unPan = installTouchCardPan(el, { getViewport, setViewport: drive });
    const unWheel = installWheelZoom(el, { getViewport, setViewport: drive });
    return () => { unPinch(); unPan(); unWheel(); };
  }, [s, getViewport, setViewport]);

  // Shift-drag lasso, capture-phase on the wrapper (as on the main canvas).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return installLassoSelection({
      container: el,
      editorRef: { current: s.editor },
      areaRef: { current: s.area },
      setLasso,
    });
  }, [s]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === "select") {
          const n = s.editor.getNode(ch.id);
          if (n) (n as { selected?: boolean }).selected = ch.selected;
        }
      }
      // Frame the subgraph once the freshly-opened cards have MEASURED —
      // fitView before dimensions land frames a zero-size set.
      if (pendingFitRef.current && changes.some((ch) => ch.type === "dimensions")) {
        pendingFitRef.current = false;
        requestAnimationFrame(() => void fitView({ padding: 0.15 }));
      }
      setNodes((ns) => applyNodeChanges(changes, ns));
    },
    [s, fitView],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => {
      const next = applyEdgeChanges(changes, es);
      if (changes.some((ch) => ch.type === "select")) {
        const ids = next.filter((e) => e.selected).map((e) => e.id);
        queueMicrotask(() => cableSelectionStore.replaceAll(ids));
      }
      return next;
    });
  }, []);
  const onConnect = useCallback(
    (c: Connection) => {
      void connect(s, c.source, c.sourceHandle ?? "", c.target, c.targetHandle ?? "");
    },
    [s],
  );
  const isValidConnection: IsValidConnection = useCallback(
    (c) => canConnect(s, c.source ?? "", c.sourceHandle ?? "", c.target ?? "", c.targetHandle ?? ""),
    [s],
  );
  const onConnectStart = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setCableDragging(true);
  }, []);
  const onConnectEnd = useCallback(() => setCableDragging(false), []);
  const onEdgeMouseEnter = useCallback((_e: unknown, edge: Edge) => {
    socketHighlightStore.setCableHover([
      dragSocketKey(edge.source, edge.sourceHandle ?? ""),
      dragSocketKey(edge.target, edge.targetHandle ?? ""),
    ]);
  }, []);
  const onEdgeMouseLeave = useCallback(() => socketHighlightStore.setCableHover([]), []);
  // An expanded group tows its unselected members per drag frame (RF moves the
  // selection itself); the view mirror follows so live readers see the drag.
  const dragLastPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onNodeDragStart = useCallback((_e: unknown, _node: Node, dragged: Node[]) => {
    dragLastPos.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
  }, []);
  const onNodeDrag = useCallback(
    (_e: unknown, _node: Node, dragged: Node[]) => {
      for (const n of dragged) {
        const model = s.editor.getNode(n.id);
        if (!(model instanceof GroupNode) || model.collapsed) continue;
        const last = dragLastPos.current.get(n.id);
        if (!last) continue;
        const dx = n.position.x - last.x;
        const dy = n.position.y - last.y;
        if (dx !== 0 || dy !== 0) void moveGroupMembers(s.editor, s.area, model, dx, dy, true);
      }
      for (const n of dragged) {
        dragLastPos.current.set(n.id, { ...n.position });
        s.positions.set(n.id, { ...n.position });
        const view = s.area.nodeViews.get(n.id);
        if (view) view.position = { x: n.position.x, y: n.position.y };
      }
    },
    [s],
  );
  const onNodeDragStop = useCallback(
    (_e: unknown, _node: Node, dragged: Node[]) => {
      for (const n of dragged) {
        s.positions.set(n.id, { ...n.position });
        const view = s.area.nodeViews.get(n.id);
        if (view) view.position = { ...n.position };
      }
      s.area.syncViews();
      dragLastPos.current.clear();
      scheduleRecord(comp, s);
      scheduleAutosave();
    },
    [comp, s],
  );
  const onMove = useCallback(
    (_e: unknown, viewport: Viewport) => {
      s.area.setTransform({ x: viewport.x, y: viewport.y, k: viewport.zoom });
      syncSemanticZoomFor(viewport.zoom);
    },
    [s],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      s.area.setPointer(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [s, screenToFlowPosition],
  );
  const onPaneClick = useCallback(() => cableSelectionStore.set(null), []);

  async function handleMenuSelect(entry: NodeCatalogEntry) {
    if (!menu) return;
    const node = entry.create() as SolenoidNode;
    if (node instanceof CompositeNode) await node.hydrate(ctorRegistry());
    await comp.internalEditor.addNode(node);
    const pos = screenToFlowPosition({ x: menu.screenX, y: menu.screenY });
    await s.area.translate(node.id, pos);
    setMenu(null);
  }

  return (
    <div className="solenoid-composite-editor__backdrop">
      <div
        ref={wrapperRef}
        className={`solenoid-composite-editor__host sol-rf-appcanvas${locked ? " solenoid-canvas--locked" : ""}`}
        onPointerMove={onPointerMove}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = e.target as Element | null;
          const nodeEl = target?.closest?.(".react-flow__node");
          const hitId = nodeEl?.getAttribute("data-id") ?? null;
          const hit = hitId ? comp.internalEditor.getNode(hitId) : null;
          if (hit && !(hit instanceof CompositeInputNode) && !(hit instanceof CompositeOutputNode)) {
            setMenu(null);
            setNodeMenu({
              nodeId: hit.id,
              screenX: e.clientX,
              screenY: e.clientY,
              isComposite: hit instanceof CompositeNode,
            });
          } else {
            setNodeMenu(null);
            setMenu({ screenX: e.clientX, screenY: e.clientY });
          }
        }}
      >
        {!ready && <div className="solenoid-composite-editor__loading" />}
        <ReactFlow
          id="drill"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!locked}
          elementsSelectable={!locked}
          panOnDrag={!(IS_COARSE && touchSelect)}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={onPaneClick}
          onMove={onMove}
          isValidConnection={isValidConnection}
          deleteKeyCode={null}
          selectionKeyCode={null}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          zoomOnScroll={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          colorMode={themeMode}
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1.5}
            color="var(--canvas-dot)"
            bgColor="var(--canvas-bg)"
          />
          <MiniMap
            className="solenoid-minimap"
            style={{ width: 182, height: 105 }}
            pannable
            zoomable
            nodeBorderRadius={3}
            nodeColor={(n) => minimapFillForNode((n.data as { node: SolenoidNode }).node, themeMode).background}
            nodeStrokeColor={(n) => minimapFillForNode((n.data as { node: SolenoidNode }).node, themeMode).borderColor}
            nodeStrokeWidth={1}
          />
        </ReactFlow>
        {lasso && (
          <svg
            className="solenoid-lasso"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 50 }}
          >
            <polygon
              points={lasso.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={lasso.mode === "enclose" ? "rgba(86, 180, 233, 0.10)" : "rgba(255, 220, 0, 0.10)"}
              stroke={lasso.mode === "enclose" ? "rgba(86, 180, 233, 0.9)" : "rgba(255, 220, 0, 0.95)"}
              strokeWidth={1.4}
              strokeDasharray={lasso.mode === "touch" ? "5 4" : undefined}
            />
          </svg>
        )}
        <CableInspector />
      </div>
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
      {menu && (
        <AddNodeMenu
          screenX={menu.screenX}
          screenY={menu.screenY}
          entries={buildCatalog(true)}
          onSelect={(entry) => void handleMenuSelect(entry)}
          onClose={() => setMenu(null)}
        />
      )}
      {nodeMenu && (
        <DrillNodeMenu
          menu={nodeMenu}
          onEdit={() => {
            const n = comp.internalEditor.getNode(nodeMenu.nodeId);
            if (n instanceof CompositeNode) compositeEditorStore.drillInto(n);
          }}
          onDuplicate={() => void duplicateNode(nodeMenu.nodeId)}
          onDelete={() => void deleteNode(nodeMenu.nodeId)}
          onClose={() => setNodeMenu(null)}
        />
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
