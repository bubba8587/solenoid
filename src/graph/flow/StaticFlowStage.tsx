// A minimal NON-INTERACTIVE flow surface for the side pages (landing demo,
// ?showcase audit stage): real components, real values, no pan/zoom/drag.
// Callers build their graph through the stack's editor + area verbs exactly
// like any other surface; the stage mirrors topology into RF state.
import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../schemes";
import { FlowSurfaceContext, registerFlowSocket, registerFlowResizeGrip } from "../flowSurface";
import { FlowSocketHandle } from "./FlowSocketHandle";
import { FlowResizeGrip } from "./FlowResizeGrip";
import { SolNodeAdapter, type SolFlowNode } from "./SolNodeAdapter";
import { FlowCableEdge, type SolFlowEdge } from "./FlowCableEdge";
import { toFlowNodes, toFlowEdges, toFlowPosition, type FlowModel } from "./flowModel";
import { makeFlowArea, type FlowArea } from "./flowArea";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import "./flow.css";

registerFlowSocket(FlowSocketHandle);
registerFlowResizeGrip(FlowResizeGrip);

const nodeTypes = { sol: SolNodeAdapter };
const edgeTypes = { cable: FlowCableEdge };

type StageHandlers = {
  bumpNode(id: string): void;
  bumpConnections(): void;
  moveNode(id: string, pos: { x: number; y: number }): void;
  syncTopology(): void;
};

export type StaticStack = FlowModel & {
  area: FlowArea;
  handlers: StageHandlers;
};

export function makeStaticStack(): StaticStack {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const positions = new Map<string, { x: number; y: number }>();
  const handlers: StageHandlers = {
    bumpNode: () => {},
    bumpConnections: () => {},
    moveNode: () => {},
    syncTopology: () => {},
  };
  const area = makeFlowArea(editor, positions, {
    bumpNode: (id) => handlers.bumpNode(id),
    bumpConnections: () => handlers.bumpConnections(),
    moveNode: (id, pos) => handlers.moveNode(id, pos),
    setViewport: () => {},
    getContainer: () => null,
  });
  const s: StaticStack = { editor, engine, positions, area, handlers };
  let queued = false;
  editor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (
      t === "nodecreated" || t === "noderemoved" ||
      t === "connectioncreated" || t === "connectionremoved"
    ) {
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
  return s;
}

function StageInner({ stack: s, zoom }: { stack: StaticStack; zoom: number }) {
  const [nodes, setNodes] = useState<SolFlowNode[]>([]);
  const [edges, setEdges] = useState<SolFlowEdge[]>([]);
  const { setViewport } = useReactFlow();

  const syncTopology = useCallback(() => {
    s.area.syncViews();
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return toFlowNodes(s).map((n) => {
        const old = prevById.get(n.id);
        if (old && old.position.x === n.position.x && old.position.y === n.position.y && old.parentId === n.parentId) return old;
        return { ...n, data: { ...n.data, version: (old?.data.version as number) ?? 0 } };
      });
    });
    setEdges(toFlowEdges(s));
  }, [s]);

  useEffect(() => {
    s.handlers.bumpNode = (id) =>
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, version: (n.data.version as number) + 1 } } : n,
        ),
      );
    s.handlers.bumpConnections = () => setEdges(toFlowEdges(s));
    s.handlers.moveNode = (id, pos) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, position: toFlowPosition(s, id, pos) } : n)));
    s.handlers.syncTopology = syncTopology;
    syncTopology();
  }, [s, syncTopology]);

  useEffect(() => {
    void setViewport({ x: 0, y: 0, zoom });
    s.area.setTransform({ x: 0, y: 0, k: zoom });
  }, [s, zoom, setViewport]);

  return (
    <ReactFlow<SolFlowNode, SolFlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: false }}
    />
  );
}

/** The stage: mount once with a stack from `makeStaticStack()`. */
export function StaticFlowStage({ stack, zoom = 1 }: { stack: StaticStack; zoom?: number }) {
  return (
    <ReactFlowProvider>
      <FlowSurfaceContext.Provider value={true}>
        <StageInner stack={stack} zoom={zoom} />
      </FlowSurfaceContext.Provider>
    </ReactFlowProvider>
  );
}
