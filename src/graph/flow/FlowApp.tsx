// React Flow port (C0) — the ?rf harness page: pick a seed, see it rendered and
// computed on React Flow. Read-only beyond drag/select; interaction lands in C1.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SolFlowNode } from "./SolFlowNode";
import { buildModel, computeAll, toFlowNodes, toFlowEdges } from "./flowModel";
import { FLOW_SEEDS, DEFAULT_SEED_ID } from "./flowSeeds";
import "./flow.css";

const nodeTypes = { sol: SolFlowNode };

export default function FlowApp() {
  const [seedId, setSeedId] = useState(DEFAULT_SEED_ID);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [stats, setStats] = useState("loading…");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const t0 = performance.now();
        const m = await buildModel(FLOW_SEEDS[seedId].graph);
        const values = await computeAll(m);
        if (!live) return;
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

  const seedOptions = useMemo(() => Object.entries(FLOW_SEEDS), []);

  return (
    <div className="sol-rf-app">
      <div className="sol-rf-bar">
        <span className="sol-rf-bar__brand">Solenoid · React Flow port (C0)</span>
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
        <span className="sol-rf-bar__stats">{stats}</span>
      </div>
      <div className="sol-rf-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesConnectable={false}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          minZoom={0.05}
          maxZoom={2.5}
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
