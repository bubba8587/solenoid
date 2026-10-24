// [[D102]] graphOnCore
// A node driven on its own through the graph core's input boundary, as an engine computes it.
import { computeNode } from "../../src/graph/engineWasm/solenoid_graph.js";
import type { GraphNode } from "../../src/graph/graphModel";
import "../../src/graph/nodeBoundary";

type DataFn = (inputs: Record<string, unknown[]>) => unknown;

/** The node's outputs on `inputs`, its `data()` run through the boundary. */
export async function computeAlone(node: GraphNode, inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
  return await (computeNode(node, inputs, undefined) as Record<string, unknown> | Promise<Record<string, unknown>>);
}

/** From here on `node.data(inputs)` runs through the boundary: synchronously when nothing it does waits. */
export function throughBoundary<T extends object>(node: T): T {
  const n = node as unknown as { data: DataFn };
  const own = n.data;
  n.data = (inputs) => computeNode(node, inputs, own);
  return node;
}
