// [[B10]] reactFlowView, [[C37]] observerOwnsSize, [[C87]] groupsAreSubflows
import type { ClassicPreset, GetSchemes } from "rete";
import type { DataflowNode } from "rete-engine";

export type SolenoidNode = ClassicPreset.Node & DataflowNode & {
  width: number;
  height: number;
  position?: { x: number; y: number };
};
export type SolenoidConnection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export type Schemes = GetSchemes<SolenoidNode, SolenoidConnection>;
