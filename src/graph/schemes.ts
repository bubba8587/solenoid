import type { ClassicPreset, GetSchemes } from "rete";
import type { ReactArea2D } from "rete-react-plugin";
import type { MinimapExtra } from "rete-minimap-plugin";
import type { DataflowNode } from "rete-engine";

// width/height are read by the minimap plugin, so every node class must default them.
export type SolenoidNode = ClassicPreset.Node & DataflowNode & {
  width: number;
  height: number;
};
// Must use base ClassicPreset.Node (variance) to satisfy both scheme constraints.
export type SolenoidConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export type Schemes = GetSchemes<SolenoidNode, SolenoidConnection>;
export type AreaExtra = ReactArea2D<Schemes> | MinimapExtra;
