import type { ClassicPreset, GetSchemes } from "rete";
import type { DataflowNode } from "rete-engine";

// width/height feed the minimap + framing math, so every node class defaults them.
// `position` is the node's ABSOLUTE canvas spot — the model's one source of truth,
// stamped by the model layer on add (flowModel, persistence, the surfaces), never
// declared by node classes; optional in the type only for the instant before the
// stamp. Write through `View.moveNode` / `flowModel.moveNode`.
export type SolenoidNode = ClassicPreset.Node & DataflowNode & {
  width: number;
  height: number;
  position?: { x: number; y: number };
};
// Must use base ClassicPreset.Node (variance) to satisfy both scheme constraints.
export type SolenoidConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export type Schemes = GetSchemes<SolenoidNode, SolenoidConnection>;
