// React Flow port (C2) — render the REAL Solenoid node components inside RF
// nodes. `emit` is only ever consumed by NodeSocket, which renders an RF Handle
// on this surface (flowSurface.ts), so a stub satisfies the contract. The
// generic C0 card stays as the fallback for anything unregistered.
import { memo, useEffect } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { componentForNode } from "../nodeRegistry";
import { withNodeBoundary } from "../components/ErrorBoundary";
import type { Emit } from "../components/nodeKit";
import { SolFlowNode } from "./SolFlowNode";
import type { SolenoidNode } from "../schemes";

export type FlowNodeData = {
  node: SolenoidNode;
  /** Bumped by the area adapter's `update("node", id)` — rete's re-render verb. */
  version: number;
  [key: string]: unknown;
};
/** THE node type of both surfaces (RF generics: `<ReactFlow<SolFlowNode, SolFlowEdge>>`). */
export type SolFlowNode = Node<FlowNodeData, "sol">;

const stubEmit = (() => {}) as unknown as Emit;

function SolNodeAdapterBase(props: NodeProps<SolFlowNode>) {
  const { id, data, selected } = props;
  // Components read selection off the payload (rete convention).
  (data.node as unknown as { selected?: boolean }).selected = !!selected;
  const updateNodeInternals = useUpdateNodeInternals();
  // A version bump can mean swapped/retyped sockets (op change, FC retype,
  // extensible rows) — have RF re-measure this node's handles.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data.version, updateNodeInternals]);

  const C = withNodeBoundary(componentForNode(data.node));
  if (!C) return <SolFlowNode {...props} />;
  return <C data={data.node} emit={stubEmit} />;
}

export const SolNodeAdapter = memo(SolNodeAdapterBase);
