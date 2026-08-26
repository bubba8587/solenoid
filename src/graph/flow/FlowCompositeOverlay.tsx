// React Flow port (C7 payoff) — the composite drill-in AS A FLOW SURFACE.
// Replaces the rete overlay's per-composite plugin stack with the same RF
// machinery the main canvas runs: SolNodeAdapter cards, FlowCableEdge cables,
// the flowArea adapter registered as the ACTIVE graph, and a per-composite
// snapshot history over snapshotInternal(). The rete overlay remains behind
// `?rete` until C9 removes it.
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
import type { AreaPlugin } from "rete-area-plugin";
import { FlowSurfaceContext } from "../flowSurface";
import { SolNodeAdapter } from "./SolNodeAdapter";
import { FlowCableEdge } from "./FlowCableEdge";
import { toFlowNodes, toFlowEdges, type FlowModel } from "./flowModel";
import { canConnect, connect } from "./flowController";
import { makeFlowArea, type FlowArea } from "./flowArea";
import { installFlowPinch } from "./flowPinch";
import { installTouchCardPan } from "./flowTouchPan";
import { installWheelZoom } from "./flowWheel";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "../rete-nodes";
import type { SolenoidNode, Schemes, AreaExtra } from "../schemes";
import { compositeEditorStore, compositePassStore } from "../compositeEditorStore";
import { getEditor, getArea, processGraph, setCableDragging } from "../process";
import { setActiveGraph } from "../activeGraph";
import { syncSemanticZoomFor } from "../semanticZoomStore";
import { copySelected, pasteClipboard } from "../copyPaste";
import { scheduleAutosave } from "../persistence";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { cableSelectionStore } from "../cableState";
import { canvasLockStore } from "../canvasLock";
import { isolateStore } from "../isolateStore";
import { isolateSelection } from "../isolate";
import { pushNotice } from "../noticeStore";
import { buildCatalog } from "../catalogUtils";
import { AddNodeMenu, type NodeCatalogEntry } from "../AddNodeMenu";
import { MIN_ZOOM, MAX_ZOOM } from "../areaPresets";
import { makeEnsureArrange, tidyOptionsFromSettings } from "../tidyArrange";
import { CompositeRunControls, RUN_MODE_OPTIONS } from "../components/CompositeNode";
import { minimapFillForNode } from "../components/Minimap";
import { appThemeStore } from "../appTheme";
import { DrillNodeMenu } from "../components/CompositeEditorOverlay";
import { IS_MOBILE } from "../coarse";
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
        if (old && old.position.x === n.position.x && old.position.y === n.position.y) return old;
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

  // Open: hydrate, seed positions, publish as the ACTIVE graph.
  useEffect(() => {
    let canceled = false;
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
        area: s.area as unknown as AreaPlugin<Schemes, AreaExtra>,
        history: null,
      });
      if (s.history.stack.length === 0) recordNow(comp, s);
    })();
    return () => {
      canceled = true;
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

  const ensureArrangeRef = useRef<ReturnType<typeof makeEnsureArrange> | null>(null);
  const tidyDrill = useCallback(async () => {
    if (!ensureArrangeRef.current) ensureArrangeRef.current = makeEnsureArrange(s.area, () => false);
    const arrange = await ensureArrangeRef.current();
    if (!arrange) return;
    await arrange.layout({ options: tidyOptionsFromSettings() });
    void fitView({ padding: 0.15, duration: 0 });
    void processGraph(recomputeTarget());
    scheduleAutosave();
    scheduleRecord(comp, s);
  }, [comp, s, fitView, recomputeTarget]);

  const nudgeSelection = useCallback(
    async (key: string, big: boolean) => {
      const step = big ? 40 : 8;
      const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
      const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
      for (const n of comp.internalEditor.getNodes()) {
        if (!(n as { selected?: boolean }).selected) continue;
        const pos = s.area.nodeViews.get(n.id)?.position ?? { x: 0, y: 0 };
        await s.area.translate(n.id, { x: pos.x + dx, y: pos.y + dy });
      }
    },
    [comp, s],
  );

  // The drill-in owns the keyboard while open (canvasKeyboard stands down).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;
      if (editable) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); void historyStep(false); }
        if ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY") { e.preventDefault(); void historyStep(true); }
        if (e.code === "KeyA") {
          e.preventDefault();
          cableSelectionStore.set(null);
          for (const n of comp.internalEditor.getNodes()) (n as { selected?: boolean }).selected = true;
          setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
        }
        if (e.code === "KeyC" && !e.shiftKey) { e.preventDefault(); copySelected(); }
        if (e.code === "KeyV" && !e.shiftKey) {
          e.preventDefault();
          const pos = screenToFlowPosition({ x: cursorRef.current.x, y: cursorRef.current.y });
          void pasteClipboard(pos.x, pos.y);
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteSelection();
      }
      if (e.code === "KeyA") {
        e.preventDefault();
        setMenu({ screenX: cursorRef.current.x, screenY: cursorRef.current.y });
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        void tidyDrill();
      }
      if (e.code === "KeyI") {
        e.preventDefault();
        if (isolateStore.isActive()) isolateStore.exit(); else isolateSelection();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        void nudgeSelection(e.key, e.shiftKey);
      }
      if (e.key === "Escape") {
        if (menu) setMenu(null);
        else if (isolateStore.isActive()) isolateStore.exit();
        else void drillTo(compositeEditorStore.stack().length - 2);
      }
    }
    const onMouseMove = (e: MouseEvent) => { cursorRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
    };
  });

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
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      s.positions.set(node.id, { ...node.position });
      const view = s.area.nodeViews.get(node.id);
      if (view) view.position = { ...node.position };
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
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!locked}
          elementsSelectable={!locked}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={onPaneClick}
          onMove={onMove}
          isValidConnection={isValidConnection}
          deleteKeyCode={null}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          zoomOnScroll={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          colorMode="system"
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
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
