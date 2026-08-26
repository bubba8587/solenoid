// THE React Flow surface, shared by the main canvas (FlowCanvas) and the composite
// drill-in (FlowCompositeOverlay): one RF element, one set of handlers, gestures,
// lasso, context menus, keyboard, add menu, HTML-in-Canvas layer and inspector over a
// SurfaceStack. The hosts differ only through SurfaceHooks (what settles an edit,
// which history answers undo, what Delete removes) and their own chrome.
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
import { ClassicPreset } from "rete";
import type { Schemes } from "../schemes";
import type { Surface } from "../surface";
import { registerFlowSocket, registerFlowResizeGrip } from "../flowSurface";
import { FlowSocketHandle } from "./FlowSocketHandle";
import { FlowResizeGrip } from "./FlowResizeGrip";
import { SolNodeAdapter, type SolFlowNode } from "./SolNodeAdapter";
import { FlowCableEdge, type SolFlowEdge } from "./FlowCableEdge";
import { FlowConnectionLine } from "./FlowConnectionLine";
import { cableSelectionStore, socketHighlightStore, dragSocketKey } from "../cableState";
import { toFlowNodes, toFlowEdges, nodeClassName, toFlowPosition, fromFlowPosition, type FlowModel } from "./flowModel";
import { canConnect, connect, moveNode } from "./flowController";
import type { FlowArea } from "./flowArea";
import { setCableDragging, processGraph } from "../process";
import { installCanvasKeyboard } from "../canvasKeyboard";
import { firstCompatibleSocketKey } from "../catalogSearch";
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
import { MIN_ZOOM, MAX_ZOOM, floorZoom } from "../areaPresets";
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
import { moveGroupMembers, reconcileGroupMembership, absorbIntoContainingGroup } from "../groupLogic";
import { rebuildGroupMembership, groupMembershipStore } from "../groupMembership";
import { syncGroupCollapse } from "../groupCollapse";
import { isGraphRebuilding } from "../process";
import { canvasLockStore } from "../canvasLock";
import { installLassoSelection, type LassoState } from "../canvasLasso";
import { installFlowPinch } from "./flowPinch";
import { installTouchCardPan } from "./flowTouchPan";
import { installWheelZoom } from "./flowWheel";
import { zoomAt, type ZoomSurface } from "../zoomAt";
import { groupCollapseStore } from "../groupCollapse";
import { HtmlCanvasLayer } from "../components/HtmlCanvasLayer";
import { standoffStore, type SettleOpts } from "../standoffs";
import { appThemeStore } from "../appTheme";
import { minimapFillForNode } from "../components/Minimap";
import { computeDockedCanvasPos, dockedRenderedDims, findDockTarget, insertFcInline, removeFcInline } from "../fcDocking";
import { groupPushStore } from "../groupPush";
import { CableInspector } from "../components/CableInspector";
import { paletteStore } from "../paletteStore";
import { frStore } from "../frStore";
import { settingsPanel, settingsStore } from "../settingsStore";
import { IS_COARSE } from "../coarse";
import { touchSelectStore } from "../touchSelectStore";
import "../canvas.css";
import "./flow.css";

registerFlowSocket(FlowSocketHandle);
registerFlowResizeGrip(FlowResizeGrip);

const nodeTypes = { sol: SolNodeAdapter };
const edgeTypes = { cable: FlowCableEdge };
// Objects handed to <ReactFlow> live at module scope (RF's performance rule: a fresh
// reference per render re-renders the flow).
const SNAP_GRID: [number, number] = [DOT_SPACING, DOT_SPACING];
const FIT_PADDING = 0.15;
const PRO_OPTIONS = { hideAttribution: false };
const MINIMAP_STYLE = { width: 182, height: 105 };
const DELETE_KEYS = ["Backspace", "Delete"];
// The cable renders its own named hit path (.solenoid-cable-hit) — RF's interaction
// path would sit on top of it and eat context-menu targeting.
const DEFAULT_EDGE_OPTIONS = { type: "cable" as const, interactionWidth: 0 };
const MINIMAP_MASK = "color-mix(in srgb, var(--overlay-bg) 72%, transparent)";
// RF paints a dot at (gap/2 − size/2) into each tile; this offset slides the pattern so
// a dot sits on every multiple of DOT_SPACING — the lattice snapToGrid and the arrow
// nudge use.
const DOT_SIZE = 2;
const DOT_OFFSET = DOT_SIZE / 2 - DOT_SPACING / 2;

/** Late-bound component handlers, so a stack can exist before (and across) mounts. */
export type SurfaceHandlers = {
  bumpNode(id: string): void;
  bumpConnections(): void;
  /** Re-render every card (a completed composite pass). */
  bumpAllNodes(): void;
  moveNode(id: string, pos: { x: number; y: number }): void;
  setViewport(v: { x: number; y: number; zoom: number }): void;
  getContainer(): HTMLElement | null;
  syncTopology(): void;
  /** Re-derive RF `selected` from the model flags (after a verb wrote them). */
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
  area: FlowArea;
  handlers: SurfaceHandlers;
  standoffSettle?: (pinned?: Set<string>, opts?: SettleOpts) => void;
  /** A host-level rebuild in progress (drill-in hydrate/restore) — no live-creation behaviors. */
  isRebuilding?: () => boolean;
  absorbPipeInstalled?: boolean;
};

export type SurfaceHooks = {
  /** React Flow instance id: every internal id (pattern, marker, aria) derives from it,
   *  so two mounted flows MUST differ. */
  rfId: string;
  /** Extra wrapper classes (the drill-in host). */
  className?: string;
  history: { undo(): Promise<unknown>; redo(): Promise<unknown> };
  deleteSelected: () => Promise<void>;
  /** A drag settled (position + size + membership are the host's to record). */
  afterMove: () => void;
  /** A programmatic move landed (nudge, push, standoffs): record only. */
  afterProgrammaticMove: () => void;
  /** A node was added from the Add menu and positioned. */
  afterNodeAdded: (nodeId: string) => void | Promise<void>;
  afterConnect?: () => void;
  /** Render the standoff layer (a main-graph feature). */
  standoffs?: boolean;
  /** The main canvas stands down while the drill-in owns the keyboard. */
  standsDownWhenDrilled?: boolean;
  /** Frame the graph once the first mounted cards have measured. */
  fitViewOnInit?: boolean;
  /** Escape with nothing of the surface's own open (menu, isolate). */
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
  // RF's `fitView` prop resolves on the first setNodes, and this surface mounts EMPTY and
  // fills after the host hydrates — so frame on the measured-nodes signal instead. The
  // zoom floors to the snap step (fitView's own would land between steps).
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
    s.area.syncViews();
    // Survivors keep their OBJECT IDENTITY — RF's memo skips them, so adding
    // one node re-renders one card, not the whole canvas.
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
          old.className === n.className
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

  // Membership is RF's parentId: a rebuild (drop into / out of a group, resize,
  // create) re-projects — identity-preserving, so only the re-parented cards re-render.
  useEffect(() => groupMembershipStore.subscribe(syncTopology), [syncTopology]);

  // Member hiding follows the collapse store LIVE (a toggle changes no
  // topology, so syncTopology never runs for it) — remap RF classNames,
  // identity-preserving so untouched cards skip re-render.
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

  // Bind the late-bound handlers for this mount.
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
    // A programmatic move lands in ABSOLUTE canvas units; a member's RF position is
    // relative to its group, and a moved group re-bases every member (so a Tidy that
    // translates members before their group still ends consistent).
    s.handlers.moveNode = (id, pos) => {
      const isGroup = s.editor.getNode(id) instanceof GroupNode;
      setNodes((ns) => {
        let changed = false;
        const next = ns.map((n) => {
          let rel: { x: number; y: number } | null = null;
          if (n.id === id) rel = toFlowPosition(s, id, pos);
          else if (isGroup && n.parentId === id) {
            const abs = s.positions.get(n.id);
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

  // A node created LIVE (Add menu, paste) inside an expanded group's box joins it — once
  // the card has rendered, since containment needs its size. Loads/restores restore
  // membership from the saved list instead. editor.addPipe cannot be removed: once per stack.
  useEffect(() => {
    if (s.absorbPipeInstalled) return;
    s.absorbPipeInstalled = true;
    s.editor.addPipe((ctx) => {
      if ((ctx as { type?: string }).type === "nodecreated" && !isGraphRebuilding() && !s.isRebuilding?.()) {
        const newId = (ctx as unknown as { data: { id: string } }).data.id;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (absorbIntoContainingGroup(s.editor, s.area, newId)) {
            rebuildGroupMembership(s.editor);
            syncGroupCollapse(s.editor, s.area);
            scheduleAutosave();
          }
        }));
      }
      return ctx;
    });
  }, [s]);

  // The chrome's "open the add menu here" request (command palette, top bar +, A).
  // Registration nests: the drill-in's replaces main's while open and restores it.
  useEffect(
    () => addMenuRequest.register((screenX, screenY) => setMenu({ screenX, screenY })),
    [],
  );

  // Two fingers zoom, whatever they land on (flowPinch.ts); one touch finger
  // on an UNSELECTED card pans (flowTouchPan.ts); the app's wheel curve.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const drive = (v: { x: number; y: number; zoom: number }) => {
      void setViewport(v);
      s.area.setTransform({ x: v.x, y: v.y, k: v.zoom });
      syncSemanticZoomFor(v.zoom);
    };
    // Every editable is `nodrag`: RF's d3 drag listens on the node wrapper and its
    // filter only knows the class, so a press-drag in a field (selecting text) would
    // drag the card. Stopped in CAPTURE above the wrapper — focus and native text
    // selection are default actions and still happen.
    const EDITABLE = "input, textarea, select, [contenteditable='true'], [contenteditable='']";
    const guardEditable = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(EDITABLE)) e.stopPropagation();
    };
    el.addEventListener("mousedown", guardEditable, true);
    el.addEventListener("touchstart", guardEditable, { capture: true, passive: true });
    const unPinch = installFlowPinch(el, { getViewport, setViewport: drive });
    const unPan = installTouchCardPan(el, { getViewport, setViewport: drive });
    const unWheel = installWheelZoom(el, { getViewport, setViewport: drive });
    return () => {
      el.removeEventListener("mousedown", guardEditable, true);
      el.removeEventListener("touchstart", guardEditable, true);
      unPinch();
      unPan();
      unWheel();
    };
  }, [s, getViewport, setViewport]);

  // Isolate: view-only focus — positions snapshot on enter, restored on exit;
  // receded nodes dim via the live RF elements.
  useEffect(() => {
    let wasActive = false;
    const snapshot = new Map<string, { x: number; y: number }>();
    const apply = () => {
      const active = isolateStore.isActive();
      for (const [id, view] of s.area.nodeViews) {
        view.element.classList.toggle("solenoid-isolate-dim", active && !isolateStore.isVisible(id));
      }
      if (active && !wasActive) {
        snapshot.clear();
        const focus: Schemes["Node"][] = [];
        for (const [id, view] of s.area.nodeViews) {
          if (!isolateStore.isVisible(id)) continue;
          snapshot.set(id, { ...view.position });
          const n = s.editor.getNode(id);
          if (n) focus.push(n);
        }
        if (focus.length) {
          void zoomAt(s.area as unknown as ZoomSurface, focus);
        }
      } else if (!active && wasActive) {
        for (const [id, pos] of snapshot) {
          if (s.area.nodeViews.has(id)) void s.area.translate(id, pos);
        }
        snapshot.clear();
        scheduleAutosave();
      }
      wasActive = active;
    };
    apply();
    return isolateStore.subscribe(apply);
  }, [s]);

  // Shift-drag lasso — capture-phase on the wrapper, so RF's pane (pan, box
  // selection) never sees the press; cable hits resolve through the live
  // connectionViews.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return installLassoSelection({
      container: el,
      editorRef: { current: s.editor },
      areaRef: { current: s.area as unknown as Surface },
      setLasso,
    });
  }, [s]);

  // Context menus: RF says node / edge / pane; a socket (the dot straddles the card
  // edge, so it can sit on either) resolves first on nodes and the pane.
  const onNodeContextMenu: NodeMouseHandler<SolFlowNode> = useCallback(
    (e, node) => {
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
      if (keepsNativeMenu(e)) return;
      e.preventDefault();
      const t = cableTargetFor(s.editor, edge.id, e);
      if (t) setCableCtx(t);
    },
    [s],
  );
  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (keepsNativeMenu(e)) return;
    e.preventDefault();
    const el = wrapperRef.current;
    const sock = el ? socketTargetAt(el, e) : null;
    if (sock) { setSocketCtx(sock); return; }
    // Suppressed while isolating — no new nodes there.
    if (isolateStore.isActive()) return;
    setMenu({ screenX: e.clientX, screenY: e.clientY });
  }, []);

  // The full canvas keyboard (F9, palette, nudge, copy/paste, group verbs,
  // Ctrl+S/O…) over this surface's refs; Escape falls through to the host.
  useEffect(() => {
    const unKeys = installCanvasKeyboard({
      editorRef: { current: s.editor },
      areaRef: { current: s.area as unknown as Surface },
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
      // An open overlay (palette, reference, settings, add menu, isolate) takes it.
      if (paletteStore.get() || frStore.get() || settingsPanel.get() || menuRef.current || isolateStore.isActive()) return;
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
      // RF-driven moves (drags) land in the model's ABSOLUTE positions — a group first,
      // so a member's absolute resolves against its group's new spot.
      const moved = changes
        .filter((ch): ch is Extract<NodeChange<SolFlowNode>, { type: "position" }> => ch.type === "position" && !!ch.position)
        .sort((a, b) => Number(!(s.editor.getNode(a.id) instanceof GroupNode)) - Number(!(s.editor.getNode(b.id) instanceof GroupNode)));
      for (const ch of moved) {
        if (!s.editor.getNode(ch.id)) continue;
        const parentId = s.positions.has(ch.id) ? nodesRef.current.find((n) => n.id === ch.id)?.parentId : undefined;
        const abs = ch.positionAbsolute ?? fromFlowPosition(s, ch.position!, parentId);
        moveNode(s, ch.id, abs);
        // The view mirror too, or a live reader (the HIC layer's per-frame position
        // sync) sees the dragged node parked until dragStop's syncViews.
        const view = s.area.nodeViews.get(ch.id);
        if (view) view.position = { x: abs.x, y: abs.y };
      }
      // RF's own measures (post-layout, free) feed the surface's DOM-free size source.
      for (const ch of changes) {
        if (ch.type === "dimensions" && ch.dimensions && ch.resizing === undefined) {
          s.area.setSize(ch.id, { w: ch.dimensions.width, h: ch.dimensions.height });
        }
      }
      // A resize grip's own dimension changes (`resizing` set) stay out of RF state: the
      // model sizes the card, RF measures it (FlowResizeGrip).
      const applied = changes.filter((ch) => !(ch.type === "dimensions" && ch.resizing !== undefined));
      setNodes((ns) => applyNodeChanges(applied, ns));
    },
    [s],
  );
  const onEdgesChange = useCallback((changes: EdgeChange<SolFlowEdge>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);
  // RF's selection is THE selection: the editor payloads (chrome + components read
  // `selected`) and the cable store (CableInspector, delete verbs, the edge's selected
  // color) mirror it.
  const onSelectionChange = useCallback(
    ({ nodes: sel, edges: selEdges }: { nodes: SolFlowNode[]; edges: SolFlowEdge[] }) => {
      const ids = new Set(sel.map((n) => n.id));
      for (const n of s.editor.getNodes()) (n as { selected?: boolean }).selected = ids.has(n.id);
      cableSelectionStore.replaceAll(selEdges.map((e) => e.id));
    },
    [s],
  );
  useOnSelectionChange({ onChange: onSelectionChange });
  // …and a cable selected on the app side (its hit path, run selection) is selected
  // in RF too. Identity-preserving, so untouched edges skip re-render.
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
  // Delete/Backspace is RF's key (input-gated there); the app's own delete removes the
  // selection from the MODEL and RF state follows the topology pipe — so RF is told
  // to remove nothing itself (it would also take a deleted group's members).
  const onBeforeDelete: OnBeforeDelete<SolFlowNode, SolFlowEdge> = useCallback(async () => {
    if (computeOverlayStore.visible() || presentationStore.isActive()) return false;
    if (hooksRef.current.standsDownWhenDrilled && compositeEditorStore.isOpen()) return false;
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
  const onPaneClick = useCallback(() => cableSelectionStore.set(null), []);
  const onMove = useCallback(
    (_e: unknown, viewport: Viewport) => {
      s.area.setTransform({ x: viewport.x, y: viewport.y, k: viewport.zoom });
      syncSemanticZoomFor(viewport.zoom);
    },
    [s],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      screenMouseRef.current = { x: e.clientX, y: e.clientY };
      s.area.setPointer(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [s, screenToFlowPosition],
  );

  // A cable drag must commit a mid-edit field FIRST (blur), and lights the
  // origin socket for the drag's duration.
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
      // Quick-wire (a Setting, off by default): a cable dropped on the pane opens the
      // Add menu pre-filtered to what the origin socket can take, and wires the pick.
      const handleId = state.fromHandle?.id ?? null;
      if (settingsStore.get("quickWire") && state.isValid === null && state.fromNode && handleId && !canvasLockStore.get()) {
        const side = state.fromHandle?.type === "source" ? "output" : "input";
        const pt = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
        const originNode = s.editor.getNode(state.fromNode.id);
        const sock =
          side === "output" ? originNode?.outputs[handleId]?.socket : originNode?.inputs[handleId]?.socket;
        const compatibleTypes = sock instanceof SolenoidSocket ? new Set([sock.dataType]) : undefined;
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
      if (canvasLockStore.get()) return false; // view-only when locked
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false;
      return canConnect(s, c.source, c.sourceHandle, c.target, c.targetHandle);
    },
    [s],
  );
  // The cable-change pipe (reconcile + rescan + targeted recompute) settles
  // this, exactly as it settles component-driven cable changes.
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

  // RF tows a group's members itself (they are its RF children); the MODEL's
  // absolute member positions follow by the group's per-frame delta. Selected
  // members are skipped (RF already moves the selection).
  const dragLastPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onNodeDragStart: OnNodeDrag<SolFlowNode> = useCallback((_e, _node, dragged) => {
    dragLastPos.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
  }, []);
  const standoffRaf = useRef(0);
  const onNodeDrag: OnNodeDrag<SolFlowNode> = useCallback(
    (_e, _node, dragged) => {
      for (const n of dragged) {
        const model = s.editor.getNode(n.id);
        if (!(model instanceof GroupNode) || model.collapsed) continue;
        const last = dragLastPos.current.get(n.id);
        if (!last) continue;
        const dx = n.position.x - last.x;
        const dy = n.position.y - last.y;
        if (dx !== 0 || dy !== 0) void moveGroupMembers(s.editor, s.area, model, dx, dy, true);
      }
      for (const n of dragged) dragLastPos.current.set(n.id, { ...n.position });
      // Tow standoff-tied neighbors live, one solve per frame.
      if (s.standoffSettle && !standoffStore.isEmpty() && !standoffRaf.current) {
        const pinned = new Set(dragged.map((n) => n.id));
        standoffRaf.current = requestAnimationFrame(() => {
          standoffRaf.current = 0;
          s.area.syncViews();
          s.standoffSettle?.(pinned);
        });
      }
    },
    [s],
  );
  const onNodeDragStop: OnNodeDrag<SolFlowNode> = useCallback(
    (_e, _node, dragged) => {
      s.area.syncViews();
      // The exact settle on drop (the per-frame solves converge toward it).
      if (s.standoffSettle && !standoffStore.isEmpty()) s.standoffSettle(new Set(dragged.map((n) => n.id)));
      // A node dropped with its center inside an expanded group joins it; dragged out,
      // it leaves (exclusive + stable, see reconcileGroupMembership).
      let membershipTouched = false;
      for (const n of dragged) {
        if (s.editor.getNode(n.id) instanceof GroupNode) continue;
        reconcileGroupMembership(s.editor, s.area, n.id);
        membershipTouched = true;
      }
      if (membershipTouched) {
        rebuildGroupMembership(s.editor);
        syncGroupCollapse(s.editor, s.area);
      }
      for (const n of dragged) {
        // A manual move invalidates any expand-time push record (a click never
        // starts an RF drag, so every dragStop is a real move).
        groupPushStore.invalidateGroup(n.id);
        // A dragged FC re-homes to the nearest socket, or releases its dock.
        const model = s.editor.getNode(n.id);
        if (model instanceof FormatControllerNode) {
          const el = wrapperRef.current;
          if (!el) continue;
          const fc = model;
          const target = findDockTarget(s.area, s.editor, fc);
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
              const dims = dockedRenderedDims(s.area, fc.id, fc.width, fc.height);
              const pos = computeDockedCanvasPos(s.area, el, fc.hostNodeId, fc.socketKey, fc.side, dims.w, dims.h);
              if (pos) await s.area.translate(fc.id, pos);
              await insertFcInline(s.editor, fc);
              await processGraph();
            })();
          } else if (target) {
            fc.dockSelf(s.editor);
            const dims = dockedRenderedDims(s.area, fc.id, fc.width, fc.height);
            const pos = computeDockedCanvasPos(s.area, el, fc.hostNodeId, fc.socketKey, fc.side, dims.w, dims.h);
            if (pos) void s.area.translate(fc.id, pos);
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
      // A node created from an INPUT drag meets the drop point with its OUTPUT
      // edge, so it shifts left by its width once the card has rendered.
      const fromInput = menu.quickWire?.side === "input";
      await s.area.translate(node.id, { x: Math.round(pos.x), y: Math.round(pos.y) });
      if (fromInput) {
        requestAnimationFrame(() => {
          const w = s.area.nodeViews.get(node.id)?.element.offsetWidth ?? 0;
          if (w > 0) void s.area.translate(node.id, { x: Math.round(pos.x) - w, y: Math.round(pos.y) });
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
          try {
            const conn =
              side === "output"
                ? new ClassicPreset.Connection(originNode, originKey, node, newKey)
                : new ClassicPreset.Connection(node, newKey, originNode, originKey);
            await s.editor.addConnection(conn as Parameters<typeof s.editor.addConnection>[0]);
          } catch {
            // Incompatible after all — leave the node unwired.
          }
        }
      }

      setMenu(null);
      await hooksRef.current.afterNodeAdded(node.id);
    },
    [menu, s, screenToFlowPosition],
  );

  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  // SELECT mode (the mobile pill): taps toggle nodes in and out, background taps
  // keep the selection. RF's store flag carries exactly those semantics, and
  // pane-drag panning yields to the lasso (canvasLasso arms without Shift while
  // the pill is on; flowTouchPan stands down likewise).
  const touchSelect = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);
  useEffect(() => {
    if (!IS_COARSE) return;
    storeApi.setState({ multiSelectionActive: touchSelect });
    return () => storeApi.setState({ multiSelectionActive: false });
  }, [storeApi, touchSelect]);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const themeMode = appThemeStore.getMode();
  const gridSnap = useSyncExternalStore(gridSnapStore.subscribe, gridSnapStore.get);
  const minimapNodeColor = useCallback(
    (n: SolFlowNode) => minimapFillForNode(n.data.node, themeMode).background,
    [themeMode],
  );
  const minimapNodeStrokeColor = useCallback(
    (n: SolFlowNode) => minimapFillForNode(n.data.node, themeMode).borderColor,
    [themeMode],
  );
  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const visibleCatalog = useMemo(() => buildCatalog(true), [packsVersion]);

  return (
    <div
      ref={wrapperRef}
      className={`sol-rf-appcanvas${hooks.className ? ` ${hooks.className}` : ""}${locked ? " solenoid-canvas--locked" : ""}`}
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
        panOnDrag={!(IS_COARSE && touchSelect)}
        zoomOnScroll={false}
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
        deleteKeyCode={DELETE_KEYS}
        selectionKeyCode={null}
        // The canvas keyboard nudges the SELECTION on the dot grid (RF's own arrow
        // move needs a focused card and steps 5px) — one arrow handler, not two.
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
      <HtmlCanvasLayer editor={s.editor} area={s.area as unknown as Surface} />
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
              if (el) await attachFormatController(s.editor, s.area as unknown as Surface, el, t);
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
              if (el) await insertConduitForCables(s.editor, s.area as unknown as Surface, el, t);
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
          onLinkStandoff={(t) => linkStandoffBetween(s.editor, s.area as unknown as Surface, t)}
          onAddComment={(id) => commentsPanelUi.openFor(id)}
          onEditComposite={(id) => {
            const n = s.editor.getNode(id);
            if (!(n instanceof CompositeNode)) return;
            // Open a fresh level from the canvas, drill one deeper when already editing.
            if (compositeEditorStore.isOpen()) compositeEditorStore.drillInto(n);
            else compositeEditorStore.open(n);
          }}
          onUnpackComposite={(id) => void unpackComposite(s.editor, s.area as unknown as Surface, id)}
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
      <CableInspector />
      {children}
    </div>
  );
}
