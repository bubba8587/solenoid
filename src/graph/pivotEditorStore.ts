// [[B10]] reactFlowView (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import type { PivotNode } from "./rete-nodes";

export interface PivotEditorState {
  node: PivotNode;
  nodeId: string;
  title: string;
  accent?: string;
}

export const pivotEditor = createValueStore<PivotEditorState>();
