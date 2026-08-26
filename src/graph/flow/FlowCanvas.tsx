// React Flow port — THE app canvas on this branch (Canvas.tsx is the rete
// fallback behind ?rete). One editor/engine/area stack lives for the app's
// lifetime; documents load through the REAL persistence/documentStore path;
// chrome talks to it through the process.ts slots exactly as before.
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
import "@xyflow/react/dist/style.css";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../schemes";
import { setFlowSurface } from "../flowSurface";
import { FlowSocketHandle } from "./FlowSocketHandle";
import { SolNodeAdapter } from "./SolNodeAdapter";
import { FlowCableEdge } from "./FlowCableEdge";
import { cableSelectionStore, socketHighlightStore, dragSocketKey } from "../cableState";
import { toFlowNodes, toFlowEdges, type FlowModel } from "./flowModel";
import { canConnect, connect, disconnect, removeNodes, moveNode } from "./flowController";
import { makeFlowArea, type FlowArea } from "./flowArea";
import {
  setEditorRefs,
  setCtorRegistryProvider,
  setGraphChanged,
  setUnselectAllNodes,
  setSelectNode,
  setDeleteSelected,
  setCableDragging,
  setClearHistory,
  processGraph,
  markGraphCustom,
} from "../process";
import { flowHistory } from "./flowHistory";
import type { HistoryPlugin } from "rete-history-plugin";
import { installCanvasKeyboard } from "../canvasKeyboard";
import { flattenLeaves, filterByCompatibleSocket, firstCompatibleSocketKey } from "../catalogSearch";
import { SolenoidSocket } from "../sockets";
import { ClassicPreset } from "rete";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import { ctorRegistry } from "../nodeCtorRegistry";
import { scheduleAutosave } from "../persistence";
import { documentStore, ensureFirstDocument } from "../documentStore";
import { nodeNameStore } from "../nodeNameStore";
import { syncSemanticZoomFor } from "../semanticZoomStore";
import { buildCatalog } from "../catalogUtils";
import { AddNodeMenu, type NodeCatalogEntry } from "../AddNodeMenu";
import { addMenuRequest } from "../addMenuStore";
import { packsStore } from "../packs";
import { CompositeNode } from "../rete-nodes";
import { MIN_ZOOM, MAX_ZOOM } from "../areaPresets";
import { isolateStore } from "../isolateStore";
import { paletteStore } from "../paletteStore";
import { CommandPalette } from "../CommandPalette";
import { SocketLegend, ConfirmDialog, NoticeToasts } from "../components";
import { LoadOverlay } from "../components/LoadOverlay";
import { ComputeOverlay } from "../components/ComputeOverlay";
import { IsolatePill } from "../components/IsolatePill";
import { CableInspector } from "../components/CableInspector";
import { settingsStore } from "../settingsStore";
import { IS_MOBILE } from "../coarse";
import "./flow.css";

setFlowSurface(FlowSocketHandle);

const nodeTypes = { sol: SolNodeAdapter };
const edgeTypes = { cable: FlowCableEdge };

// Late-bound component handlers, so the app-lifetime stack (below) can exist
// before (and across) mounts of the React component.
type Handlers = {
  bumpNode(id: string): void;
  bumpConnections(): void;
  moveNode(id: string, pos: { x: number; y: number }): void;
  setViewport(v: { x: number; y: number; zoom: number }): void;
  getContainer(): HTMLElement | null;
  syncTopology(): void;
};

type Stack = FlowModel & { area: FlowArea; handlers: Handlers; docInit: boolean };

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
  const positions = new Map<string, { x: number; y: number }>();
  const handlers: Handlers = {
    bumpNode: () => {},
    bumpConnections: () => {},
    moveNode: () => {},
    setViewport: () => {},
    getContainer: () => null,
    syncTopology: () => {},
  };
  const area = makeFlowArea(editor, positions, {
    bumpNode: (id) => handlers.bumpNode(id),
    bumpConnections: () => handlers.bumpConnections(),
    moveNode: (id, pos) => handlers.moveNode(id, pos),
    setViewport: (v) => handlers.setViewport(v),
    getContainer: () => handlers.getContainer(),
  });
  // Topology changes from ANY writer (loadGraph, components' own drops,
  // canvas verbs) reach RF state through one coalesced editor watch.
  let queued = false;
  editor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (
      t === "nodecreated" || t === "noderemoved" ||
      t === "connectioncreated" || t === "connectionremoved"
    ) {
      if (t === "noderemoved") {
        const id = (ctx as unknown as { data: { id: string } }).data.id;
        positions.delete(id);
      }
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          handlers.syncTopology();
        });
      }
    }
    return ctx;
  });
  setEditorRefs(editor, engine, area);
  setCtorRegistryProvider(ctorRegistry);
  _stack = { editor, engine, positions, area, handlers, docInit: false };
  return _stack;
}

function FlowCanvasInner() {
  const s = useMemo(getStack, []);
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const screenMouseRef = useRef({ x: 0, y: 0 });
  const { setViewport, screenToFlowPosition } = useReactFlow();

  const syncTopology = useCallback(() => {
    s.area.syncViews();
    setNodes((prev) => {
      const version = new Map(prev.map((n) => [n.id, (n.data.version as number) ?? 0]));
      const selected = new Map(prev.map((n) => [n.id, n.selected]));
      return toFlowNodes(s).map((n) => ({
        ...n,
        selected: selected.get(n.id) ?? false,
        data: { ...n.data, version: version.get(n.id) ?? 0 },
      })) as unknown as Node[];
    });
    setEdges(toFlowEdges(s) as unknown as Edge[]);
  }, [s]);

  // Bind the late-bound handlers for this mount.
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
      // Position-only changes (nudge, group push, standoffs) never run
      // processGraph, so they record here; load/undo rebuilds are guarded out.
      flowHistory.schedule();
    };
    s.handlers.setViewport = (v) => {
      void setViewport(v);
      syncSemanticZoomFor(v.zoom);
    };
    s.handlers.getContainer = () => wrapperRef.current;
    s.handlers.syncTopology = syncTopology;
    syncTopology();
  }, [s, setViewport, syncTopology]);

  // Chrome contract (process.ts slots) + the document lifecycle, once.
  useEffect(() => {
    setUnselectAllNodes(() => {
      for (const n of s.editor.getNodes()) (n as { selected?: boolean }).selected = false;
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    });
    setSelectNode((id, accumulate) => {
      for (const n of s.editor.getNodes()) {
        const sel = n.id === id || (accumulate && (n as { selected?: boolean }).selected === true);
        (n as { selected?: boolean }).selected = sel;
      }
      setNodes((ns) =>
        ns.map((n) => {
          const sel = n.id === id || (accumulate && n.selected === true);
          return sel === (n.selected ?? false) ? n : { ...n, selected: sel };
        }),
      );
    });
    // The single delete verb: editor-selected nodes AND store-selected cables
    // (RF's own deleteKeyCode is off so there is exactly one path).
    setDeleteSelected(async () => {
      const doomed = s.editor.getNodes().filter((n) => (n as { selected?: boolean }).selected);
      const cables = cableSelectionStore.ids();
      if (doomed.length === 0 && cables.length === 0) return;
      for (const id of cables) await disconnect(s, id);
      cableSelectionStore.set(null);
      await removeNodes(s, doomed.map((n) => n.id));
      await processGraph(undefined, undefined, { topology: true });
      markGraphCustom();
      scheduleAutosave();
    });

    if (!s.docInit) {
      s.docInit = true;
      // Component-internal edits reach us here (processGraph's graphChanged);
      // each settled change autosaves AND records an undo step.
      setGraphChanged(() => {
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
  }, [s]);

  // The chrome's "open the add menu here" request (command palette, top bar +).
  useEffect(
    () => addMenuRequest.register((screenX, screenY) => setMenu({ screenX, screenY })),
    [],
  );

  // The full canvas keyboard (F9, palette, nudge, copy/paste, group verbs,
  // Ctrl+S/O…). History ref stays null until C5 — undo/redo simply no-op.
  useEffect(() => {
    return installCanvasKeyboard({
      editorRef: { current: s.editor },
      areaRef: { current: s.area },
      historyRef: {
        current: {
          undo: () => flowHistory.undo(),
          redo: () => flowHistory.redo(),
        } as unknown as HistoryPlugin<Schemes>,
      },
      containerRef: wrapperRef,
      screenMouseRef,
      isAddMenuOpen: () => menuRef.current !== null,
      deleteSelected: async () => {
        const { deleteSelected } = await import("../process");
        await deleteSelected();
      },
    });
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
      setNodes((ns) => applyNodeChanges(changes, ns));
    },
    [s],
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

  // A cable drag must commit a mid-edit field FIRST (rete's connectionpick
  // blur), and lights the origin socket for the drag's duration.
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
  const onConnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      state: {
        isValid: boolean | null;
        fromNode: { id: string } | null;
        fromHandle: { id?: string | null; type?: string | null } | null;
        toNode: unknown;
      },
    ) => {
      setCableDragging(false);
      socketHighlightStore.setDrag([]);
      // Quick-wire: a drop on empty canvas opens the Add menu; the pick splices.
      if (!settingsStore.get("quickWire")) return;
      if (state.toNode || state.isValid || !state.fromNode || !state.fromHandle?.id) return;
      const side: "input" | "output" = state.fromHandle.type === "source" ? "output" : "input";
      const nodeId = state.fromNode.id;
      const key = state.fromHandle.id;
      const originNode = s.editor.getNode(nodeId);
      const originSocket =
        side === "output" ? originNode?.outputs[key]?.socket : originNode?.inputs[key]?.socket;
      if (!(originSocket instanceof SolenoidSocket)) return;
      const leaves = flattenLeaves(buildCatalog(true));
      const compatible = filterByCompatibleSocket(leaves, originSocket, side);
      if (!compatible.length) return;
      const pt = "changedTouches" in event
        ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
        : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      setMenu({
        screenX: pt.x,
        screenY: pt.y,
        quickWire: { nodeId, key, side },
        compatibleTypes: new Set(compatible.map((lc) => lc.leaf.type)),
      });
    },
    [s],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (c) => {
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
        if (ok) {
          await processGraph(c.target, undefined, { topology: true });
          markGraphCustom();
          scheduleAutosave();
        }
      })();
    },
    [s],
  );
  const onNodeDragStop = useCallback(
    (_e: unknown, _node: Node, dragged: Node[]) => {
      for (const n of dragged) moveNode(s, n.id, n.position);
      s.area.syncViews();
      markGraphCustom();
      scheduleAutosave();
      flowHistory.schedule();
    },
    [s],
  );

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    const ev = e as MouseEvent;
    setMenu({ screenX: ev.clientX, screenY: ev.clientY });
  }, []);

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
      await processGraph(node.id, undefined, { topology: true });
      markGraphCustom();
      scheduleAutosave();
    },
    [menu, s, screenToFlowPosition],
  );

  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const visibleCatalog = useMemo(() => buildCatalog(true), [packsVersion]);
  const paletteOpen = useSyncExternalStore(paletteStore.subscribe, paletteStore.get);
  const paletteAlwaysOnSetting = useSyncExternalStore(
    settingsStore.subscribe,
    () => settingsStore.get("commandPaletteAlwaysOn"),
  );
  const paletteAlwaysOn = Boolean(paletteAlwaysOnSetting) && !IS_MOBILE;

  return (
    <div ref={wrapperRef} className="sol-rf-appcanvas" onPointerMove={onPointerMove}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
        onPaneContextMenu={onPaneContextMenu}
        isValidConnection={isValidConnection}
        deleteKeyCode={null}
        elevateNodesOnSelect={false}
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        colorMode="system"
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
        <MiniMap pannable zoomable />
      </ReactFlow>
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
      {(paletteOpen || paletteAlwaysOn) && (
        <CommandPalette persistent={paletteAlwaysOn} onClose={() => paletteStore.close()} />
      )}
      <SocketLegend />
      <IsolatePill />
      <CableInspector />
      <ConfirmDialog />
      <NoticeToasts />
      <LoadOverlay />
      <ComputeOverlay />
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}
