// React Flow port — the ?rf surface. C0 rendered read-only; C1 adds the
// interaction baseline: wire/unwire through the socket lattice, delete, drag
// persistence, a minimal add menu, and Save (a normal Solenoid document).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SolFlowNode } from "./SolFlowNode";
import { buildModel, toFlowNodes, toFlowEdges, type FlowModel } from "./flowModel";
import {
  recompute,
  canConnect,
  connect,
  disconnect,
  removeNodes,
  addNode,
  moveNode,
  serialize,
  type Values,
} from "./flowController";
import { FLOW_SEEDS, DEFAULT_SEED_ID } from "./flowSeeds";
import { FLAT_CATALOG } from "../catalogUtils";
import { MIN_ZOOM, MAX_ZOOM } from "../areaPresets";
import "./flow.css";

const nodeTypes = { sol: SolFlowNode };
const DELETE_KEYS = ["Backspace", "Delete"];

function FlowSurface() {
  const [seedId, setSeedId] = useState(DEFAULT_SEED_ID);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [stats, setStats] = useState("loading…");
  const [addOpen, setAddOpen] = useState(false);
  const modelRef = useRef<FlowModel | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const applyValues = useCallback((values: Values) => {
    setNodes((ns) =>
      ns.map((n) =>
        values.has(n.id) ? { ...n, data: { ...n.data, outputs: values.get(n.id) } } : n,
      ),
    );
  }, []);

  /** Recompute after a model edit and refresh values + edge list from the editor. */
  const refresh = useCallback(
    async (changedId?: string) => {
      const m = modelRef.current;
      if (!m) return;
      const values = await recompute(m, changedId);
      setEdges(toFlowEdges(m) as unknown as Edge[]);
      applyValues(values);
      setStats(`${m.editor.getNodes().length} nodes · ${m.editor.getConnections().length} cables`);
    },
    [applyValues],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const t0 = performance.now();
        const m = await buildModel(FLOW_SEEDS[seedId].graph);
        const values = await recompute(m);
        if (!live) return;
        modelRef.current = m;
        setNodes(toFlowNodes(m, values) as unknown as Node[]);
        setEdges(toFlowEdges(m) as unknown as Edge[]);
        const ms = Math.round(performance.now() - t0);
        setStats(
          `${m.editor.getNodes().length} nodes · ${m.editor.getConnections().length} cables · built+computed in ${ms}ms`,
        );
      } catch (e) {
        if (live) setStats(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [seedId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );

  const isValidConnection: IsValidConnection = useCallback((c) => {
    const m = modelRef.current;
    if (!m || !c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false;
    return canConnect(m, c.source, c.sourceHandle, c.target, c.targetHandle);
  }, []);

  const onConnect = useCallback(
    (c: Connection) => {
      const m = modelRef.current;
      if (!m || !c.sourceHandle || !c.targetHandle) return;
      void (async () => {
        const ok = await connect(m, c.source, c.sourceHandle!, c.target, c.targetHandle!);
        if (ok) await refresh(c.target);
      })();
    },
    [refresh],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const m = modelRef.current;
      if (!m || deleted.length === 0) return;
      void (async () => {
        const downstream = deleted.map((e) => e.target);
        for (const e of deleted) await disconnect(m, e.id);
        // One changed node → targeted cone; several → full pass keeps it simple.
        await refresh(downstream.length === 1 ? downstream[0] : undefined);
      })();
    },
    [refresh],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const m = modelRef.current;
      if (!m || deleted.length === 0) return;
      void (async () => {
        await removeNodes(m, deleted.map((n) => n.id));
        await refresh();
      })();
    },
    [refresh],
  );

  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    const m = modelRef.current;
    if (m) moveNode(m, node.id, node.position);
  }, []);

  const onAddNode = useCallback(
    (catalogType: string) => {
      const m = modelRef.current;
      if (!m) return;
      setAddOpen(false);
      void (async () => {
        const pos = screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        const node = await addNode(m, catalogType, pos);
        if (!node) return;
        setNodes((ns) => [
          ...ns,
          {
            id: node.id,
            type: "sol",
            position: m.positions.get(node.id) ?? pos,
            data: { node, outputs: null },
          } as unknown as Node,
        ]);
        await refresh(node.id);
      })();
    },
    [refresh, screenToFlowPosition],
  );

  const onSave = useCallback(() => {
    const m = modelRef.current;
    if (!m) return;
    const g = serialize(m);
    const blob = new Blob([JSON.stringify(g, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${seedId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [seedId]);

  const seedOptions = useMemo(() => Object.entries(FLOW_SEEDS), []);

  return (
    <div className="sol-rf-app">
      <div className="sol-rf-bar">
        <span className="sol-rf-bar__brand">Solenoid · React Flow port</span>
        <select
          className="sol-rf-bar__seed"
          value={seedId}
          onChange={(e) => setSeedId(e.target.value)}
        >
          {seedOptions.map(([id, s]) => (
            <option key={id} value={id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="sol-rf-bar__btn" onClick={() => setAddOpen((v) => !v)}>
          Add node
        </button>
        <button className="sol-rf-bar__btn" onClick={onSave}>
          Save
        </button>
        <span className="sol-rf-bar__stats">{stats}</span>
      </div>
      {addOpen && <AddMenu onPick={onAddNode} onClose={() => setAddOpen(false)} />}
      <div className="sol-rf-canvas">
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
          isValidConnection={isValidConnection}
          deleteKeyCode={DELETE_KEYS}
          zoomOnDoubleClick={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          fitView
          colorMode="system"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

/** C1's minimal add menu: a filter box over the flat catalog. The real Add
 *  menu (tree, descriptions, quick-wire) is C4 chrome. */
function AddMenu({ onPick, onClose }: { onPick: (type: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const entries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...FLAT_CATALOG.entries()];
    const hits = needle
      ? all.filter(
          ([type, e]) =>
            e.label.toLowerCase().includes(needle) ||
            type.toLowerCase().includes(needle) ||
            (e.keywords ?? "").toLowerCase().includes(needle),
        )
      : all;
    return hits.slice(0, 40);
  }, [q]);
  return (
    <div className="sol-rf-add">
      <div className="sol-rf-add__head">
        <input
          autoFocus
          placeholder="Filter nodes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && entries.length > 0) onPick(entries[0][0]);
          }}
        />
      </div>
      <div className="sol-rf-add__list">
        {entries.map(([type, e]) => (
          <button key={type} className="sol-rf-add__item" onClick={() => onPick(type)}>
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function FlowApp() {
  return (
    <ReactFlowProvider>
      <FlowSurface />
    </ReactFlowProvider>
  );
}
