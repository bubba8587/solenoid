// [[C43]] oneFlowSurface, [[B10]] reactFlowView
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
  /** Bumped by `view.rerenderNode(id)`. */
  version: number;
  [key: string]: unknown;
};
export type SolFlowNode = Node<FlowNodeData, "sol">;

const stubEmit = (() => {}) as unknown as Emit;

function SolNodeAdapterBase(props: NodeProps<SolFlowNode>) {
  const { id, data, selected } = props;
  // Components read selection off the node payload.
  (data.node as unknown as { selected?: boolean }).selected = !!selected;
  const updateNodeInternals = useUpdateNodeInternals();
  // A version bump can mean swapped or retyped sockets, so RF re-measures this node's handles.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data.version, updateNodeInternals]);

  const C = withNodeBoundary(componentForNode(data.node));
  if (!C) return <SolFlowNode {...props} />;
  return <C data={data.node} emit={stubEmit} />;
}

export const SolNodeAdapter = memo(SolNodeAdapterBase);
