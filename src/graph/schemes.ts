// [[A1]] visualGraphCalculator, [[B12]] losslessSaves
import type { DataflowNode } from "./dataflowEngine";
import type { GraphConnection, GraphNode } from "./graphModel";

export type SolenoidNode = GraphNode & DataflowNode & {
  width: number;
  height: number;
  position?: { x: number; y: number };
};
export type SolenoidConnection = GraphConnection;

export type Schemes = { Node: SolenoidNode; Connection: SolenoidConnection };
