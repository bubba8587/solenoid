// THE React Flow surface, shared by the main canvas (FlowCanvas) and the composite
// drill-in (FlowCompositeOverlay): one RF element, one set of handlers, gestures,
// lasso, context menus, keyboard, add menu, HTML-in-Canvas layer and inspector over a
// SurfaceStack. The hosts differ only through SurfaceHooks (what settles an edit,
// which history answers undo, what Delete removes) and their own chrome.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  ViewportPortal,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  useStoreApi,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type IsValidConnection,
  type OnConnectEnd,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ClassicPreset } from "rete";
import type { Schemes, SolenoidNode } from "../schemes";
import type { Surface } from "../surface";
import { registerFlowSocket } from "../flowSurface";
import { FlowSocketHandle } from "./FlowSocketHandle";
import { SolNodeAdapter } from "./SolNodeAdapter";
import { FlowCableEdge } from "./FlowCableEdge";
import { FlowConnectionLine } from "./FlowConnectionLine";
import { cableSelectionStore, socketHighlightStore, dragSocketKey } from "../cableState";
import { toFlowNodes, toFlowEdges, nodeClassName, type FlowModel } from "./flowModel";
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
import { MIN_ZOOM, MAX_ZOOM } from "../areaPresets";
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
import { installCanvasContextMenu } from "../canvasContextMenu";
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
import { rebuildGroupMembership } from "../groupMembership";
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

const nodeTypes = { sol: SolNodeAdapter };
const edgeTypes = { cable: FlowCableEdge };

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
  /** Frame the graph once the freshly-mounted cards have measured. */
  fitOnMeasure?: MutableRefObject<boolean>;
  /** Escape with nothing of the surface's own open (menu, isolate). */
  onEscape?: () => void;
};

export function FlowSurface({ stack: s, hooks, children }: { stack: SurfaceStack; hooks: SurfaceHooks; children?: ReactNode }) {
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
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
  const { setViewport, getViewport, screenToFlowPosition, fitView } = useReactFlow();

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
          old.zIndex === n.zIndex &&
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
          n.id === id ? { ...n, data: { ...n.data, version: (n.data.version as number) + 1 } } : n,
        ),
      );
    s.handlers.bumpConnections = () => setEdges(toFlowEdges(s) as unknown as Edge[]);
    s.handlers.bumpAllNodes = () =>
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, version: (n.data.version as number) + 1 } })));
    s.handlers.moveNode = (id, pos) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, position: { ...pos } } : n)));
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
    const unPinch = installFlowPinch(el, { getViewport, setViewport: drive });
    const unPan = installTouchCardPan(el, { getViewport, setViewport: drive });
    const unWheel = installWheelZoom(el, { getViewport, setViewport: drive });
    return () => {
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

  // Native contextmenu targeting (sockets → cables → nodes → pane): resolves
  // through data-socket attrs, the .solenoid-cable-hit path, and nodeViews
  // element containment.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return installCanvasContextMenu({
      el,
      editorRef: { current: s.editor },
      areaRef: { current: s.area as unknown as Surface },
      setSocketCtx,
      setCableCtx,
      setNodeCtx,
      openAddMenu: (screenX, screenY) => setMenu({ screenX, screenY }),
    });
  }, [s]);

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
      deleteSelected: () => hooksRef.current.deleteSelected(),
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
    (changes: NodeChange[]) => {
      // Mirror RF selection into the editor payloads (chrome + components read it).
      for (const ch of changes) {
        if (ch.type === "select") {
          const n = s.editor.getNode(ch.id);
          if (n) (n as { selected?: boolean }).selected = ch.selected;
        }
      }
      // Frame the graph once the freshly-mounted cards have MEASURED —
      // fitView before dimensions land frames a zero-size set.
      const fit = hooksRef.current.fitOnMeasure;
      if (fit?.current && changes.some((ch) => ch.type === "dimensions")) {
        fit.current = false;
        requestAnimationFrame(() => void fitView({ padding: 0.15 }));
      }
      setNodes((ns) => applyNodeChanges(changes, ns));
    },
    [s, fitView],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => {
      const next = applyEdgeChanges(changes, es);
      // Mirror RF edge selection into the cable store (CableInspector, delete
      // verbs, and the edge's selected color all read it). Deferred — a store
      // notify must not fire inside a state updater.
      if (changes.some((ch) => ch.type === "select")) {
        const ids = next.filter((e) => e.selected).map((e) => e.id);
        queueMicrotask(() => cableSelectionStore.replaceAll(ids));
      }
      return next;
    });
  }, []);
  const onEdgeMouseEnter = useCallback((_e: unknown, edge: Edge) => {
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

  const isValidConnection: IsValidConnection = useCallback(
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

  // A REAL header drag on a group tows its members (programmatic translates
  // must not). Delta comes from the previous drag frame; selected members are
  // skipped (RF already moves the selection).
  const dragLastPos = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onNodeDragStart = useCallback((_e: unknown, _node: Node, dragged: Node[]) => {
    dragLastPos.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
  }, []);
  const standoffRaf = useRef(0);
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
        moveNode(s, n.id, n.position);
        // The view mirror too, or a live reader (the HIC layer's per-frame position
        // sync) sees the dragged node parked until dragStop's syncViews.
        const view = s.area.nodeViews.get(n.id);
        if (view) view.position = { x: n.position.x, y: n.position.y };
      }
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
  const onNodeDragStop = useCallback(
    (_e: unknown, _node: Node, dragged: Node[]) => {
      for (const n of dragged) moveNode(s, n.id, n.position);
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
  const storeApi = useStoreApi();
  const touchSelect = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);
  useEffect(() => {
    if (!IS_COARSE) return;
    storeApi.setState({ multiSelectionActive: touchSelect });
    return () => storeApi.setState({ multiSelectionActive: false });
  }, [storeApi, touchSelect]);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const themeMode = appThemeStore.getMode();
  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const visibleCatalog = useMemo(() => buildCatalog(true), [packsVersion]);

  return (
    <div
      ref={wrapperRef}
      className={`sol-rf-appcanvas${hooks.className ? ` ${hooks.className}` : ""}${locked ? " solenoid-canvas--locked" : ""}`}
      onPointerMove={onPointerMove}
    >
      <ReactFlow
        id={hooks.rfId}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={FlowConnectionLine}
        nodesDraggable={!locked}
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
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={onNodeDragStop}
        onMove={onMove}
        isValidConnection={isValidConnection}
        deleteKeyCode={null}
        selectionKeyCode={null}
        elevateNodesOnSelect={false}
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        colorMode={themeMode}
        proOptions={{ hideAttribution: false }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={2}
          color="var(--canvas-dot)"
          bgColor="var(--canvas-bg)"
        />
        {hooks.standoffs && (
          <ViewportPortal>
            <StandoffLayer />
          </ViewportPortal>
        )}
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
