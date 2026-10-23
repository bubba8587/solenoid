// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
import { createValueStore } from "./storeKit";
import type { PivotNode } from "./nodeClasses";

export interface PivotEditorState {
  node: PivotNode;
  nodeId: string;
  title: string;
  accent?: string;
  /** Called once the editor closes, to hand back to whatever opened it. */
  onClosed?: () => void;
}

export const pivotEditor = createValueStore<PivotEditorState>();
