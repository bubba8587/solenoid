// [[D102]] graphOnCore
// A node computed through the input boundary on its own, with the inputs given as the engine would hand them.
import { wrapNodeData } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import type { GraphNode } from "../../src/graph/graphModel";

export async function computeAlone(node: GraphNode, inputs: Record<string, unknown[]>): Promise<Record<string, unknown>> {
  wrapNodeData(node as never);
  installErrorGuards(node);
  return await (node as unknown as { data(i: Record<string, unknown[]>): unknown }).data(inputs) as Record<string, unknown>;
}
