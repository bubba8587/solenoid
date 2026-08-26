import type { ClassicPreset, GetSchemes } from "rete";
import type { DataflowNode } from "rete-engine";

// width/height feed the minimap + framing math, so every node class defaults them.
export type SolenoidNode = ClassicPreset.Node & DataflowNode & {
  width: number;
  height: number;
};
// Must use base ClassicPreset.Node (variance) to satisfy both scheme constraints.
export type SolenoidConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export type Schemes = GetSchemes<SolenoidNode, SolenoidConnection>;
// A phantom render-signal parameter left over from rete's AreaPlugin generics;
// dissolves with the AreaPlugin type itself when the surface type replaces it.
export type AreaExtra = never;
