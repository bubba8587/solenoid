// [[B10]] reactFlowView, [[C37]] observerOwnsSize, [[C87]] groupsAreSubflows
import type { ClassicPreset, GetSchemes } from "rete";
import type { DataflowNode } from "rete-engine";

// width/height are the measurement mirror ([[C37]] observerOwnsSize). `position` is the
// node's ABSOLUTE canvas spot, stamped by the model layer on add and never declared by a
// node class; optional in the type only for the instant before the stamp. Write through
// `View.moveNode` / `flowModel.moveNode`.
export type SolenoidNode = ClassicPreset.Node & DataflowNode & {
  width: number;
  height: number;
  position?: { x: number; y: number };
};
// Must use base ClassicPreset.Node (variance) to satisfy both scheme constraints.
export type SolenoidConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export type Schemes = GetSchemes<SolenoidNode, SolenoidConnection>;
