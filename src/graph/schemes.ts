import type { ClassicPreset, GetSchemes } from "rete";
import type { ReactArea2D } from "rete-react-plugin";
import type { MinimapExtra } from "rete-minimap-plugin";
import type { DataflowNode } from "rete-engine";

// Nodes must implement DataflowEngine's `data()` contract so the engine
// can call them. Our concrete node classes all provide `data()`.
// width/height are read by the minimap plugin to plot each node's box;
// every node class sets defaults in its constructor.
export type SolenoidNode = ClassicPreset.Node & DataflowNode & {
  width: number;
  height: number;
};
// Connection must use base ClassicPreset.Node (not SolenoidNode) to satisfy
// both ClassicScheme and DataflowEngineScheme constraints.
export type SolenoidConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export type Schemes = GetSchemes<SolenoidNode, SolenoidConnection>;
export type AreaExtra = ReactArea2D<Schemes> | MinimapExtra;
