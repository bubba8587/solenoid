// [[B3]] sameNodeEverywhere, [[A1]] visualGraphCalculator
import { memo, useEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { componentForNode } from "../nodeRegistry";
import { withNodeBoundary } from "../components/ErrorBoundary";
import type { Emit } from "../components/nodeKit";
import { SolFlowNode } from "./SolFlowNode";
import type { SolenoidNode } from "../schemes";

type FlowNodeData = {
  node: SolenoidNode;
  /** Bumped by `view.rerenderNode(id)`. */
  version: number;
  [key: string]: unknown;
};
export type SolFlowNode = Node<FlowNodeData, "sol">;

const stubEmit = (() => {}) as unknown as Emit;

type FlowStore = ReturnType<typeof useStoreApi>;
type MeasureUpdates = Parameters<ReturnType<FlowStore["getState"]>["updateNodeInternals"]>[0];
/** Re-measures queued per React Flow instance, flushed together in the next frame, so a pass that re-renders many
 *  cards costs React Flow one store update and React one commit, not one each. */
const pendingMeasure = new WeakMap<FlowStore, Set<string>>();
function queueMeasure(store: FlowStore, id: string): void {
  let ids = pendingMeasure.get(store);
  if (ids) { ids.add(id); return; }
  ids = new Set([id]);
  pendingMeasure.set(store, ids);
  requestAnimationFrame(() => {
    pendingMeasure.delete(store);
    const { domNode, updateNodeInternals } = store.getState();
    const updates: MeasureUpdates = new Map();
    for (const nid of ids!) {
      const nodeElement = domNode?.querySelector<HTMLDivElement>(`.react-flow__node[data-id="${CSS.escape(nid)}"]`);
      if (nodeElement) updates.set(nid, { id: nid, nodeElement, force: true });
    }
    if (updates.size) updateNodeInternals(updates, { triggerFitView: false });
  });
}

/** The card's sockets in order: what React Flow's handle bounds depend on beyond the card's size. */
const socketSignature = (node: SolenoidNode): string =>
  `${Object.keys(node.inputs).join("\u0001")}\u0002${Object.keys(node.outputs).join("\u0001")}`;

function SolNodeAdapterBase(props: NodeProps<SolFlowNode>) {
  const { id, data, selected } = props;
  // Components read selection off the node payload.
  (data.node as unknown as { selected?: boolean }).selected = !!selected;
  const store = useStoreApi();
  // A version bump re-measures the card's handles only when its sockets were added, removed or reordered: a resize
  // already re-measures them (React Flow's own observer), and a new value with the same sockets moves none.
  const measured = useRef<string | null>(null);
  const signature = socketSignature(data.node);
  useEffect(() => {
    if (measured.current === signature) return;
    measured.current = signature;
    queueMeasure(store, id);
  }, [id, data.version, signature, store]);

  const C = withNodeBoundary(componentForNode(data.node));
  if (!C) return <SolFlowNode {...props} />;
  return <C data={data.node} emit={stubEmit} />;
}

// A card reads only its id, its payload (`data`, whose version a re-render bumps) and its selection. RF also passes the
// absolute position (new every drag frame), the dragging flag, the measured size (new after the card itself resizes)
// and the stacking order; none reaches a card, so none re-renders it.
function sameCard(a: NodeProps<SolFlowNode>, b: NodeProps<SolFlowNode>): boolean {
  return a.id === b.id && a.data === b.data && a.selected === b.selected && a.type === b.type;
}

export const SolNodeAdapter = memo(SolNodeAdapterBase, sameCard);
