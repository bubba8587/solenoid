// [[C43]] oneFlowSurface, [[B10]] reactFlowView
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ViewportPortal,
  applyNodeChanges,
  applyEdgeChanges,
  getNodesBounds,
  getViewportForBounds,
  useReactFlow,
  useStoreApi,
  useNodesInitialized,
  useOnSelectionChange,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type IsValidConnection,
  type OnConnectEnd,
  type OnNodeDrag,
  type OnBeforeDelete,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Schemes } from "../schemes";
import type { View } from "../view";
import { registerFlowSocket, registerFlowResizeGrip } from "../flowSurface";
import { FlowSocketHandle } from "./FlowSocketHandle";
import { FlowResizeGrip } from "./FlowResizeGrip";
import { SolNodeAdapter, type SolFlowNode } from "./SolNodeAdapter";
import { FlowCableEdge, type SolFlowEdge } from "./FlowCableEdge";
import { FlowConnectionLine } from "./FlowConnectionLine";
import { cableSelectionStore, socketHighlightStore, dragSocketKey } from "../cableState";
import { toFlowNodes, toFlowEdges, nodeClassName, toFlowPosition, fromFlowPosition, type FlowModel } from "./flowModel";
import { canConnect, connect, moveNode } from "./flowModel";
import type { FlowView } from "./flowView";
import { processGraph } from "../process";
import { cableDragStore, setCableDragging } from "../graphSignals";
import { installCanvasKeyboard } from "../canvasKeyboard";
import { firstCompatibleSocketKey, quickWireCompatibleTypes } from "../catalogSearch";
import { SolenoidSocket } from "../sockets";
import { ctorRegistry } from "../nodeCtorRegistry";
import { scheduleAutosave } from "../persistence";
import { nodeNameStore } from "../nodeNameStore";
import { syncSemanticZoomFor } from "../semanticZoomStore";
import { buildCatalog } from "../catalogUtils";
import { AddNodeMenu, type NodeCatalogEntry } from "../AddNodeMenu";
import { addMenuRequest } from "../addMenuStore";
import { packsStore } from "../packs";
import { CompositeNode, GroupNode, FormatControllerNode } from "../rete-nodes";
import { MIN_ZOOM, MAX_ZOOM, floorZoom } from "../viewPresets";
import { gridSnapStore, DOT_SPACING } from "../gridSnapStore";
import { isolateStore } from "../isolateStore";
import {
  SocketContextMenu,
  CableContextMenu,
  NodeContextMenu,
  StandoffLayer,
  type SocketContextTarget,
  type CableContextTarget,
  type NodeContextTarget,
} from "../components";
import { keepsNativeMenu, socketTargetAt, cableTargetFor, nodeTargetFor } from "../canvasContextMenu";
import { computeOverlayStore } from "../computeOverlayStore";
import { presentationStore } from "../presentationStore";
import {
  insertConduitForCables,
  linkStandoffBetween,
  deleteCables,
  attachFormatController,
} from "../canvasActions";
import { isolateNodes, isolateChainOf, isolateWhereUsed } from "../isolate";
import { commentsPanelUi } from "../commentStore";
import { pinNodeValue } from "../pinStore";
import { unpackComposite } from "../compositeLogic";
import { compositeEditorStore } from "../compositeEditorStore";
import { moveGroupMembers, reconcileGroupMembership, absorbIntoContainingGroup, setGroupLocked } from "../groupLogic";
import { socketFlipStore } from "../socketFlipStore";
import { modalOwnsKeyboard, keyUnderModal } from "../modalGuard";
import { rebuildGroupMembership, groupMembershipStore } from "../groupMembership";
import { syncGroupCollapse } from "../groupCollapse";
import { isGraphRebuilding } from "../process";
import { canvasLockStore } from "../canvasLock";
import { installLassoSelection, type LassoState } from "../canvasLasso";
import { installFlowPinch } from "./flowPinch";
import { installTouchCardPan } from "./flowTouchPan";
import { installWheelZoom } from "./flowWheel";
import { zoomAt } from "../zoomAt";
import { groupCollapseStore } from "../groupCollapse";
import { HtmlCanvasLayer } from "../components/HtmlCanvasLayer";
import { standoffStore, type SettleOpts } from "../standoffs";
import { appThemeStore } from "../appTheme";
import { paletteStore as colorPaletteStore } from "../palette";
import { minimapFillForNode } from "../components/Minimap";
import { computeDockedCanvasPos, dockedRenderedDims, findDockTarget, insertFcInline, removeFcInline } from "../fcDocking";
import { groupPushStore } from "../groupPush";
import { CableInspector } from "../components/CableInspector";
import { DrawnCableLayer } from "../components/DrawnCableLayer";
import { PendingCableLayer } from "../components/PendingCableLayer";
import { DrawnCableCapture } from "../components/DrawnCableCapture";
import { DrawnCableInspector } from "../components/DrawnCableInspector";
import { drawnCableStore } from "../drawnCables";
import { settingsStore } from "../settingsStore";
import { IS_COARSE } from "../coarse";
import { touchSelectStore } from "../touchSelectStore";
import "../canvas.css";
import "./flow.css";

registerFlowSocket(FlowSocketHandle);
registerFlowResizeGrip(FlowResizeGrip);

const nodeTypes = { sol: SolNodeAdapter };
const edgeTypes = { cable: FlowCableEdge };
// Objects handed to <ReactFlow> live at module scope, because a fresh reference per render re-renders the flow.
const SNAP_GRID: [number, number] = [DOT_SPACING, DOT_SPACING];
const FIT_PADDING = 0.15;
const PRO_OPTIONS = { hideAttribution: false };
const MINIMAP_STYLE = { width: 182, height: 105 };
const DELETE_KEYS = ["Backspace", "Delete"];
const DEFAULT_EDGE_OPTIONS = { type: "cable" as const, interactionWidth: 0 };
const MINIMAP_MASK = "color-mix(in srgb, var(--overlay-bg) 72%, transparent)";
const DOT_SIZE = 2;
const DOT_OFFSET = DOT_SIZE / 2 - DOT_SPACING / 2;

export type SurfaceHandlers = {
  bumpNode(id: string): void;
  bumpConnections(): void;
  bumpAllNodes(): void;
  moveNode(id: string, pos: { x: number; y: number }): void;
  setViewport(v: { x: number; y: number; zoom: number }): void;
  getContainer(): HTMLElement | null;
  syncTopology(): void;
  syncSelection(): void;
};

export function idleHandlers(): SurfaceHandlers {
  return {
    bumpNode: () => {},
    bumpConnections: () => {},
    bumpAllNodes: () => {},
    moveNode: () => {},
    setViewport: () => {},
    getContainer: () => null,
    syncTopology: () => {},
    syncSelection: () => {},
  };
}

export type SurfaceStack = FlowModel & {
  view: FlowView;
  handlers: SurfaceHandlers;
  standoffSettle?: (pinned?: Set<string>, opts?: SettleOpts) => void;
  isRebuilding?: () => boolean;
  absorbPipeInstalled?: boolean;
};

export type SurfaceHooks = {
  rfId: string;
  className?: string;
  history: { undo(): Promise<unknown>; redo(): Promise<unknown> };
  deleteSelected: () => Promise<void>;
  afterMove: () => void;
  afterProgrammaticMove: () => void;
  afterNodeAdded: (nodeId: string) => void | Promise<void>;
  afterConnect?: () => void;
  standoffs?: boolean;
  drawnCables?: boolean;
  standsDownWhenDrilled?: boolean;
  noKeyboard?: boolean;
  noContextMenu?: boolean;
  locked?: boolean;
  staticView?: boolean;
  fitViewOnInit?: boolean;
  onEscape?: () => void;
};

export function FlowSurface({ stack: s, hooks, children }: { stack: SurfaceStack; hooks: SurfaceHooks; children?: ReactNode }) {
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const [nodes, setNodes] = useState<SolFlowNode[]>([]);
  const [edges, setEdges] = useState<SolFlowEdge[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [menu, setMenu] = useState<{
    screenX: number;
    screenY: number;
    quickWire?: { nodeId: string; key: string; side: "input" | "output" };
    compatibleTypes?: Set<string>;
  } | null>(null);
  const menuRef = useRef<typeof menu>(null);
  menuRef.current = menu;
  const [lasso, setLasso] = useState<LassoState>(null);
  const [socketCtx, setSocketCtx] = useState<SocketContextTarget | null>(null);
  const [cableCtx, setCableCtx] = useState<CableContextTarget | null>(null);
  const [nodeCtx, setNodeCtx] = useState<NodeContextTarget | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const screenMouseRef = useRef({ x: 0, y: 0 });
  const { setViewport, getViewport, screenToFlowPosition, getNodes } = useReactFlow();
  const storeApi = useStoreApi();
  const nodesInitialized = useNodesInitialized();
  const fitDoneRef = useRef(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!nodesInitialized || fitDoneRef.current || !hooksRef.current.fitViewOnInit || !el) return;
    fitDoneRef.current = true;
    const b = getNodesBounds(getNodes(), { nodeLookup: storeApi.getState().nodeLookup });
    const w = el.clientWidth;
    const h = el.clientHeight;
    const zoom = floorZoom(getViewportForBounds(b, w, h, MIN_ZOOM, MAX_ZOOM, FIT_PADDING).zoom);
    void setViewport({ x: w / 2 - (b.x + b.width / 2) * zoom, y: h / 2 - (b.y + b.height / 2) * zoom, zoom });
  }, [nodesInitialized, getNodes, setViewport, storeApi]);

  const syncTopology = useCallback(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return toFlowNodes(s).map((n) => {
        const old = prevById.get(n.id);
        if (
          old &&
          old.position.x === n.position.x &&
          old.position.y === n.position.y &&
          old.parentId === n.parentId &&
          old.zIndex === n.zIndex &&
          old.className === n.className &&
          old.draggable === n.draggable
        ) {
          return old;
        }
        return {
          ...n,
          selected: old?.selected ?? false,
          data: { ...n.data, version: old?.data.version ?? 0 },
        };
      });
    });
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]));
      return toFlowEdges(s).map((e) => prevById.get(e.id) ?? e);
    });
  }, [s]);

  useEffect(() => groupMembershipStore.subscribe(syncTopology), [syncTopology]);

  useEffect(() => {
    const restamp = () =>
      setNodes((ns) => {
        let changed = false;
        const next = ns.map((n) => {
          const cls = nodeClassName(n.data.node);
          if ((n.className ?? undefined) === cls) return n;
          changed = true;
          return { ...n, className: cls };
        });
        return changed ? next : ns;
      });
    const offCollapse = groupCollapseStore.subscribe(restamp);
    const offIsolate = isolateStore.subscribe(restamp);
    return () => { offCollapse(); offIsolate(); };
  }, []);

  useEffect(() => {
    s.handlers.bumpNode = (id) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, version: n.data.version + 1 } } : n,
        ),
      );
    s.handlers.bumpConnections = () => setEdges(toFlowEdges(s));
    s.handlers.bumpAllNodes = () =>
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, version: n.data.version + 1 } })));
    s.handlers.moveNode = (id, pos) => {
      const isGroup = s.editor.getNode(id) instanceof GroupNode;
      setNodes((ns) => {
        let changed = false;
        const next = ns.map((n) => {
          let rel: { x: number; y: number } | null = null;
          if (n.id === id) rel = toFlowPosition(s, id, pos);
          else if (isGroup && n.parentId === id) {
            const abs = s.editor.getNode(n.id)?.position;
            if (abs) rel = { x: abs.x - pos.x, y: abs.y - pos.y };
          }
          if (!rel || (rel.x === n.position.x && rel.y === n.position.y)) return n;
          changed = true;
          return { ...n, position: rel };
        });
        return changed ? next : ns;
      });
      hooksRef.current.afterProgrammaticMove();
    };
    s.handlers.setViewport = (v) => {
      void setViewport(v);
      syncSemanticZoomFor(v.zoom);
    };
    s.handlers.getContainer = () => wrapperRef.current;
    s.handlers.syncTopology = syncTopology;
    s.handlers.syncSelection = () =>
      setNodes((ns) =>
        ns.map((n) => {
          const sel = (s.editor.getNode(n.id) as { selected?: boolean } | undefined)?.selected === true;
          return sel === (n.selected ?? false) ? n : { ...n, selected: sel };
        }),
      );
    syncTopology();
  }, [s, setViewport, syncTopology]);

  // editor.addPipe cannot be removed, so this pipe installs once per stack.
  useEffect(() => {
    if (s.absorbPipeInstalled) return;
    s.absorbPipeInstalled = true;
    s.editor.addPipe((ctx) => {
      if ((ctx as { type?: string }).type === "nodecreated" && !isGraphRebuilding() && !s.isRebuilding?.()) {
        const newId = (ctx as unknown as { data: { id: string } }).data.id;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (absorbIntoContainingGroup(s.editor, s.view, newId)) {
            rebuildGroupMembership(s.editor);
            syncGroupCollapse(s.editor, s.view);
            scheduleAutosave();
          }
        }));
      }
      return ctx;
    });
  }, [s]);

  useEffect(
    () => addMenuRequest.register((screenX, screenY) => { if (!canvasLockStore.get()) setMenu({ screenX, screenY }); }),
    [],
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const drive = (v: { x: number; y: number; zoom: number }) => {
      void setViewport(v);
      s.view.setTransform({ x: v.x, y: v.y, k: v.zoom });
      syncSemanticZoomFor(v.zoom);
    };
    const EDITABLE = "input, textarea, select, [contenteditable='true'], [contenteditable='']";
    const guardEditable = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(EDITABLE)) e.stopPropagation();
    };
    el.addEventListener("mousedown", guardEditable, true);
    el.addEventListener("touchstart", guardEditable, { capture: true, passive: true });
    const noop = () => {};
    const stat = hooksRef.current.staticView === true;
    const unPinch = stat ? noop : installFlowPinch(el, { getViewport, setViewport: drive });
    const unPan = stat ? noop : installTouchCardPan(el, { getViewport, setViewport: drive });
    const unWheel = stat ? noop : installWheelZoom(el, { getViewport, setViewport: drive });
    return () => {
      el.removeEventListener("mousedown", guardEditable, true);
      el.removeEventListener("touchstart", guardEditable, true);
      unPinch();
      unPan();
      unWheel();
    };
  }, [s, getViewport, setViewport]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !hooksRef.current.noContextMenu) return;
    const eat = (e: Event) => e.preventDefault();
    el.addEventListener("contextmenu", eat, true);
    return () => el.removeEventListener("contextmenu", eat, true);
  }, [s]);

  useEffect(() => {
    let wasActive = false;
    const apply = () => {
      const active = isolateStore.isActive();
      if (active && !wasActive) {
        const focus = s.editor.getNodes().filter((n) => isolateStore.isVisible(n.id));
        if (focus.length) void zoomAt(s.view, focus);
      }
      wasActive = active;
    };
    apply();
    return isolateStore.subscribe(apply);
  }, [s]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return installLassoSelection({
      container: el,
      editorRef: { current: s.editor },
      viewRef: { current: s.view as unknown as View },
      setLasso,
    });
  }, [s]);

  const onNodeContextMenu: NodeMouseHandler<SolFlowNode> = useCallback(
    (e, node) => {
      if (hooksRef.current.noContextMenu) { e.preventDefault(); return; }
      if (keepsNativeMenu(e)) return;
      e.preventDefault();
      const el = wrapperRef.current;
      const sock = el ? socketTargetAt(el, e) : null;
      if (sock) { setSocketCtx(sock); return; }
      const t = nodeTargetFor(s.editor, node.id, e);
      if (t) setNodeCtx(t);
    },
    [s],
  );
  const onEdgeContextMenu: EdgeMouseHandler<SolFlowEdge> = useCallback(
    (e, edge) => {
      if (hooksRef.current.noContextMenu) { e.preventDefault(); return; }
      if (keepsNativeMenu(e)) return;
      e.preventDefault();
      const t = cableTargetFor(s.editor, edge.id, e);
      if (t) setCableCtx(t);
    },
    [s],
  );
  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (hooksRef.current.noContextMenu) { e.preventDefault(); return; }
    if (keepsNativeMenu(e)) return;
    e.preventDefault();
    const el = wrapperRef.current;
    const sock = el ? socketTargetAt(el, e) : null;
    if (sock) { setSocketCtx(sock); return; }
    if (isolateStore.isActive() || canvasLockStore.get()) return;
    setMenu({ screenX: e.clientX, screenY: e.clientY });
  }, []);

  useEffect(() => {
    const unKeys = hooksRef.current.noKeyboard
      ? () => {}
      : installCanvasKeyboard({
      editorRef: { current: s.editor },
      viewRef: { current: s.view as unknown as View },
      historyRef: {
        current: {
          undo: () => hooksRef.current.history.undo(),
          redo: () => hooksRef.current.history.redo(),
        },
      },
      containerRef: wrapperRef,
      screenMouseRef,
      isAddMenuOpen: () => menuRef.current !== null,
      standsDownWhenDrilled: hooksRef.current.standsDownWhenDrilled,
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !hooksRef.current.onEscape) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable) return;
      if (keyUnderModal(e) || menuRef.current || isolateStore.isActive()) return;
      hooksRef.current.onEscape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unKeys();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [s]);

  const onNodesChange = useCallback(
    (changes: NodeChange<SolFlowNode>[]) => {
      const moved = changes
        .filter((ch): ch is Extract<NodeChange<SolFlowNode>, { type: "position" }> => ch.type === "position" && !!ch.position)
        .sort((a, b) => Number(!(s.editor.getNode(a.id) instanceof GroupNode)) - Number(!(s.editor.getNode(b.id) instanceof GroupNode)));
      for (const ch of moved) {
        if (!s.editor.getNode(ch.id)) continue;
        const parentId = nodesRef.current.find((n) => n.id === ch.id)?.parentId;
        const abs = ch.positionAbsolute ?? fromFlowPosition(s, ch.position!, parentId);
        moveNode(s, ch.id, abs);
      }
      for (const ch of changes) {
        if (ch.type === "dimensions" && ch.dimensions && ch.resizing === undefined) {
          s.view.setSize(ch.id, { w: ch.dimensions.width, h: ch.dimensions.height });
        }
      }
      // A grip resize (`resizing` set) stays out of RF state: the model sizes the card and RF only measures it.
      const applied = changes.filter((ch) => !(ch.type === "dimensions" && ch.resizing !== undefined));
      setNodes((ns) => applyNodeChanges(applied, ns));
    },
    [s],
  );
  const onEdgesChange = useCallback((changes: EdgeChange<SolFlowEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);
  const onSelectionChange = useCallback(
    ({ nodes: sel, edges: selEdges }: { nodes: SolFlowNode[]; edges: SolFlowEdge[] }) => {
      const ids = new Set(sel.map((n) => n.id));
      for (const n of s.editor.getNodes()) (n as { selected?: boolean }).selected = ids.has(n.id);
      cableSelectionStore.replaceAll(selEdges.map((e) => e.id));
      if (ids.size > 0 || selEdges.length > 0) drawnCableStore.select(null);
    },
    [s],
  );
  useOnSelectionChange({ onChange: onSelectionChange });
  useEffect(
    () =>
      cableSelectionStore.subscribe(() => {
        setEdges((es) => {
          let changed = false;
          const next = es.map((e) => {
            const sel = cableSelectionStore.has(e.id);
            if ((e.selected ?? false) === sel) return e;
            changed = true;
            return { ...e, selected: sel };
          });
          return changed ? next : es;
        });
      }),
    [],
  );
  // RF is told to remove nothing: the app deletes from the model, and RF's own delete would also take a group's members.
  const onBeforeDelete: OnBeforeDelete<SolFlowNode, SolFlowEdge> = useCallback(async () => {
    if (computeOverlayStore.visible() || presentationStore.isActive() || modalOwnsKeyboard()) return false;
    if (hooksRef.current.standsDownWhenDrilled && compositeEditorStore.isOpen()) return false;
    if (canvasLockStore.get()) return false;
    await hooksRef.current.deleteSelected();
    return false;
  }, []);
  const onEdgeMouseEnter = useCallback((_e: unknown, edge: SolFlowEdge) => {
    socketHighlightStore.setCableHover([
      dragSocketKey(edge.source, edge.sourceHandle ?? ""),
      dragSocketKey(edge.target, edge.targetHandle ?? ""),
    ]);
  }, []);
  const onEdgeMouseLeave = useCallback(() => socketHighlightStore.setCableHover([]), []);
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = getViewport();
      void setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom });
    },
    [getViewport, setViewport],
  );
  const onPaneClick = useCallback(() => {
    cableSelectionStore.set(null);
    drawnCableStore.select(null);
  }, []);
  const onMove = useCallback(
    (_e: unknown, viewport: Viewport) => {
      s.view.setTransform({ x: viewport.x, y: viewport.y, k: viewport.zoom });
      syncSemanticZoomFor(viewport.zoom);
    },
    [s],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      screenMouseRef.current = { x: e.clientX, y: e.clientY };
      s.view.setPointer(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [s, screenToFlowPosition],
  );

  const onConnectStart = useCallback(
    (_e: unknown, params: { nodeId: string | null; handleId: string | null }) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      setCableDragging(true);
      if (params.nodeId && params.handleId) {
        socketHighlightStore.setDrag([dragSocketKey(params.nodeId, params.handleId)]);
      }
    },
    [],
  );
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      setCableDragging(false);
      socketHighlightStore.setDrag([]);
      const handleId = state.fromHandle?.id ?? null;
      if (settingsStore.get("quickWire") && state.isValid === null && state.fromNode && handleId && !canvasLockStore.get()) {
        const side = state.fromHandle?.type === "source" ? "output" : "input";
        const pt = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
        const originNode = s.editor.getNode(state.fromNode.id);
        const sock =
          side === "output" ? originNode?.outputs[handleId]?.socket : originNode?.inputs[handleId]?.socket;
        const compatibleTypes = sock instanceof SolenoidSocket ? quickWireCompatibleTypes(buildCatalog(true), sock, side) : undefined;
        setMenu({
          screenX: pt.clientX,
          screenY: pt.clientY,
          quickWire: { nodeId: state.fromNode.id, key: handleId, side },
          compatibleTypes,
        });
      }
    },
    [s],
  );

  const isValidConnection: IsValidConnection<SolFlowEdge> = useCallback(
    (c) => {
      if (canvasLockStore.get()) return false;
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false;
      return canConnect(s, c.source, c.sourceHandle, c.target, c.targetHandle);
    },
    [s],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.sourceHandle || !c.targetHandle) return;
      void (async () => {
        const ok = await connect(s, c.source, c.sourceHandle!, c.target, c.targetHandle!);
        if (ok) hooksRef.current.afterConnect?.();
      })();
    },
    [s],
  );

  const dragLastPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onNodeDragStart: OnNodeDrag<SolFlowNode> = useCallback((_e, _node, dragged) => {
    dragLastPos.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
  }, []);
  const standoffRaf = useRef(0);
  const onNodeDrag: OnNodeDrag<SolFlowNode> = useCallback(
    (_e, _node, dragged) => {
      for (const n of dragged) {
        const model = s.editor.getNode(n.id);
        // Collapsed groups too: RF tows the hidden member children either way, so the model must follow.
        if (!(model instanceof GroupNode)) continue;
        const last = dragLastPos.current.get(n.id);
        if (!last) continue;
        const dx = n.position.x - last.x;
        const dy = n.position.y - last.y;
        if (dx !== 0 || dy !== 0) void moveGroupMembers(s.editor, s.view, model, dx, dy, true);
      }
      for (const n of dragged) dragLastPos.current.set(n.id, { ...n.position });
      const tied = standoffStore.participants();
      const touchesTie = !standoffStore.isEmpty() && dragged.some((n) => {
        if (tied.has(n.id)) return true;
        const model = s.editor.getNode(n.id);
        return model instanceof GroupNode && model.members.some((m) => tied.has(m));
      });
      if (s.standoffSettle && touchesTie && !standoffRaf.current) {
        const pinned = new Set(dragged.map((n) => n.id));
        standoffRaf.current = requestAnimationFrame(() => {
          standoffRaf.current = 0;
          s.standoffSettle?.(pinned);
        });
      }
    },
    [s],
  );
  const onNodeDragStop: OnNodeDrag<SolFlowNode> = useCallback(
    (_e, _node, dragged) => {
      if (s.standoffSettle && !standoffStore.isEmpty()) s.standoffSettle(new Set(dragged.map((n) => n.id)));
      let membershipTouched = false;
      for (const n of dragged) {
        if (s.editor.getNode(n.id) instanceof GroupNode) continue;
        reconcileGroupMembership(s.editor, s.view, n.id);
        membershipTouched = true;
      }
      if (membershipTouched) {
        rebuildGroupMembership(s.editor);
        syncGroupCollapse(s.editor, s.view);
      }
      for (const n of dragged) {
        groupPushStore.invalidateGroup(n.id);
        const model = s.editor.getNode(n.id);
        if (model instanceof FormatControllerNode) {
          const el = wrapperRef.current;
          if (!el) continue;
          const fc = model;
          const target = findDockTarget(s.view, s.editor, fc);
          const reHome = !!target && (
            target.hostNodeId !== fc.hostNodeId ||
            target.socketKey !== fc.socketKey ||
            target.side !== fc.side
          );
          if (reHome && target) {
            void (async () => {
              await removeFcInline(s.editor, fc);
              fc.hostNodeId = target.hostNodeId;
              fc.socketKey = target.socketKey;
              fc.side = target.side;
              fc.dockSelf(s.editor);
              const dims = dockedRenderedDims(s.view, fc.id, fc.width, fc.height);
              const pos = computeDockedCanvasPos(s.view, el, fc.hostNodeId, fc.socketKey, fc.side, dims.w, dims.h);
              if (pos) await s.view.moveNode(fc.id, pos);
              await insertFcInline(s.editor, fc);
              await processGraph();
            })();
          } else if (target) {
            fc.dockSelf(s.editor);
            const dims = dockedRenderedDims(s.view, fc.id, fc.width, fc.height);
            const pos = computeDockedCanvasPos(s.view, el, fc.hostNodeId, fc.socketKey, fc.side, dims.w, dims.h);
            if (pos) void s.view.moveNode(fc.id, pos);
          } else {
            fc.releaseDock();
          }
        }
      }
      dragLastPos.current.clear();
      hooksRef.current.afterMove();
    },
    [s],
  );

  const handleMenuSelect = useCallback(
    async (entry: NodeCatalogEntry) => {
      if (!menu || isolateStore.isActive()) return;
      const node = entry.create() as Schemes["Node"];
      if (node instanceof CompositeNode) await node.hydrate(ctorRegistry());
      await s.editor.addNode(node);
      const pos = screenToFlowPosition({ x: menu.screenX, y: menu.screenY });
      const fromInput = menu.quickWire?.side === "input";
      await s.view.moveNode(node.id, { x: Math.round(pos.x), y: Math.round(pos.y) });
      if (fromInput) {
        requestAnimationFrame(() => {
          const w = s.view.nodeElement(node.id)?.offsetWidth ?? 0;
          if (w > 0) void s.view.moveNode(node.id, { x: Math.round(pos.x) - w, y: Math.round(pos.y) });
        });
      }
      nodeNameStore.ensure(node.id, node.constructor.name);

      if (menu.quickWire) {
        const { nodeId: originId, key: originKey, side } = menu.quickWire;
        const originNode = s.editor.getNode(originId);
        const originSocket =
          side === "output" ? originNode?.outputs[originKey]?.socket : originNode?.inputs[originKey]?.socket;
        const newKey =
          originSocket instanceof SolenoidSocket
            ? firstCompatibleSocketKey(node, originSocket, side)
            : null;
        if (newKey && originNode) {
          // connect, not addConnection: it evicts the cable already in a single-connection input.
          if (side === "output") await connect(s, originId, originKey, node.id, newKey);
          else await connect(s, node.id, newKey, originId, originKey);
        }
      }

      setMenu(null);
      await hooksRef.current.afterNodeAdded(node.id);
    },
    [menu, s, screenToFlowPosition],
  );

  const globalLocked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  const locked = hooks.locked || globalLocked;
  const cabling = useSyncExternalStore(cableDragStore.subscribe, cableDragStore.get);
  const touchSelect = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);
  useEffect(() => {
    if (!IS_COARSE) return;
    storeApi.setState({ multiSelectionActive: touchSelect });
    return () => storeApi.setState({ multiSelectionActive: false });
  }, [storeApi, touchSelect]);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const themeMode = appThemeStore.getMode();
  const gridSnap = useSyncExternalStore(gridSnapStore.subscribe, gridSnapStore.get);
  // RF's MiniMap recomputes only when the callback identity changes, so the palette version is a dep.
  const paletteVersion = useSyncExternalStore(colorPaletteStore.subscribe, colorPaletteStore.version);
  const minimapNodeColor = useCallback(
    (n: SolFlowNode) => minimapFillForNode(n.data.node, themeMode).background,
    [themeMode, paletteVersion],
  );
  const minimapNodeStrokeColor = useCallback(
    (n: SolFlowNode) => minimapFillForNode(n.data.node, themeMode).borderColor,
    [themeMode, paletteVersion],
  );
  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const visibleCatalog = useMemo(() => buildCatalog(true), [packsVersion]);

  return (
    <div
      ref={wrapperRef}
      className={`sol-rf-appcanvas${hooks.className ? ` ${hooks.className}` : ""}${locked ? " solenoid-canvas--locked" : ""}${cabling ? " solenoid-canvas--cabling" : ""}`}
      onPointerMove={onPointerMove}
    >
      <ReactFlow<SolFlowNode, SolFlowEdge>
        id={hooks.rfId}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={FlowConnectionLine}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        elementsSelectable={!locked}
        panOnDrag={!(IS_COARSE && touchSelect) && !hooks.staticView}
        zoomOnScroll={false}
        preventScrolling={!hooks.staticView}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onBeforeDelete={onBeforeDelete}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={onNodeDragStop}
        onMove={onMove}
        isValidConnection={isValidConnection}
        deleteKeyCode={locked || hooks.noKeyboard ? null : DELETE_KEYS}
        selectionKeyCode={null}
        disableKeyboardA11y
        zIndexMode="manual"
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        snapToGrid={gridSnap}
        snapGrid={SNAP_GRID}
        colorMode={themeMode}
        proOptions={PRO_OPTIONS}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={DOT_SPACING}
          size={DOT_SIZE}
          offset={DOT_OFFSET}
          color="var(--canvas-dot)"
          bgColor="var(--canvas-bg)"
        />
        {hooks.standoffs && (
          <ViewportPortal>
            <StandoffLayer />
          </ViewportPortal>
        )}
        {hooks.drawnCables && (
          <ViewportPortal>
            <DrawnCableLayer />
          </ViewportPortal>
        )}
        <ViewportPortal>
          <PendingCableLayer />
        </ViewportPortal>
        <MiniMap<SolFlowNode>
          className="solenoid-minimap"
          style={MINIMAP_STYLE}
          pannable
          zoomable
          bgColor="var(--overlay-bg)"
          maskColor={MINIMAP_MASK}
          nodeBorderRadius={3}
          nodeColor={minimapNodeColor}
          nodeStrokeColor={minimapNodeStrokeColor}
          nodeStrokeWidth={1}
        />
      </ReactFlow>
      <HtmlCanvasLayer editor={s.editor} view={s.view as unknown as View} />
      {menu && (
        <AddNodeMenu
          screenX={menu.screenX}
          screenY={menu.screenY}
          entries={visibleCatalog}
          compatibleTypes={menu.compatibleTypes}
          onSelect={(entry) => void handleMenuSelect(entry)}
          onClose={() => setMenu(null)}
        />
      )}
      {socketCtx && (
        <SocketContextMenu
          target={socketCtx}
          onAttachFormat={(t) =>
            void (async () => {
              const el = wrapperRef.current;
              if (el) await attachFormatController(s.editor, s.view as unknown as View, el, t);
            })()
          }
          onClose={() => setSocketCtx(null)}
        />
      )}
      {cableCtx && (
        <CableContextMenu
          target={cableCtx}
          onInsertConduit={(t) =>
            void (async () => {
              const el = wrapperRef.current;
              if (el) await insertConduitForCables(s.editor, s.view as unknown as View, el, t);
            })()
          }
          onDelete={(t) => void deleteCables(s.editor, t)}
          onClose={() => setCableCtx(null)}
        />
      )}
      {nodeCtx && (
        <NodeContextMenu
          target={nodeCtx}
          onIsolate={(ids) => isolateNodes(ids)}
          onIsolateChain={(ids) => isolateChainOf(ids)}
          onWhereUsed={(id) => isolateWhereUsed(id)}
          onPin={(id) => pinNodeValue(id)}
          onLinkStandoff={(t) => linkStandoffBetween(s.editor, s.view as unknown as View, t)}
          onAddComment={(id) => commentsPanelUi.openFor(id)}
          onEditComposite={(id) => {
            const n = s.editor.getNode(id);
            if (!(n instanceof CompositeNode)) return;
            if (compositeEditorStore.isOpen()) compositeEditorStore.drillInto(n);
            else compositeEditorStore.open(n);
          }}
          onUnpackComposite={(id) => void unpackComposite(s.editor, s.view as unknown as View, id)}
          onToggleLock={(id) => {
            const n = s.editor.getNode(id);
            if (n instanceof GroupNode) setGroupLocked(s.editor, s.view as unknown as View, n, !n.lockedPosition);
          }}
          onToggleFlip={(id) => {
            socketFlipStore.toggle(id);
            void (s.view as unknown as View).rerenderNode(id);
          }}
          onClose={() => setNodeCtx(null)}
        />
      )}
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
      {hooks.drawnCables && <DrawnCableCapture toFlow={screenToFlowPosition} panBy={panBy} zoom={() => getViewport().zoom} />}
      <CableInspector />
      {hooks.drawnCables && <DrawnCableInspector />}
      {children}
    </div>
  );
}
