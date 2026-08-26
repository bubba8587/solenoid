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
  processGraph,
  markGraphCustom,
} from "../process";
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
import "./flow.css";

setFlowSurface(FlowSocketHandle);

const nodeTypes = { sol: SolNodeAdapter };
const DELETE_KEYS = ["Backspace", "Delete"];

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
  const [menu, setMenu] = useState<{ screenX: number; screenY: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
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
    s.handlers.moveNode = (id, pos) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, position: { ...pos } } : n)));
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
    setDeleteSelected(async () => {
      const doomed = s.editor.getNodes().filter((n) => (n as { selected?: boolean }).selected);
      if (doomed.length === 0) return;
      await removeNodes(s, doomed.map((n) => n.id));
      await processGraph(undefined, undefined, { topology: true });
      scheduleAutosave();
    });

    if (!s.docInit) {
      s.docInit = true;
      setGraphChanged(() => scheduleAutosave());
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
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
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
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return;
      void (async () => {
        for (const e of deleted) await disconnect(s, e.id);
        await processGraph(deleted.length === 1 ? deleted[0].target : undefined, undefined, {
          topology: true,
        });
        markGraphCustom();
        scheduleAutosave();
      })();
    },
    [s],
  );
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      if (deleted.length === 0) return;
      void (async () => {
        await removeNodes(s, deleted.map((n) => n.id));
        await processGraph(undefined, undefined, { topology: true });
        markGraphCustom();
        scheduleAutosave();
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
      await s.area.translate(node.id, { x: Math.round(pos.x), y: Math.round(pos.y) });
      nodeNameStore.ensure(node.id, node.constructor.name);
      setMenu(null);
      await processGraph(node.id, undefined, { topology: true });
      markGraphCustom();
      scheduleAutosave();
    },
    [menu, s, screenToFlowPosition],
  );

  const packsVersion = useSyncExternalStore(packsStore.subscribe, packsStore.version);
  const visibleCatalog = useMemo(() => buildCatalog(true), [packsVersion]);

  return (
    <div ref={wrapperRef} className="sol-rf-appcanvas" onPointerMove={onPointerMove}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodesDelete={onNodesDelete}
        onNodeDragStop={onNodeDragStop}
        onMove={onMove}
        onPaneContextMenu={onPaneContextMenu}
        isValidConnection={isValidConnection}
        deleteKeyCode={DELETE_KEYS}
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
          onSelect={(entry) => void handleMenuSelect(entry)}
          onClose={() => setMenu(null)}
        />
      )}
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
