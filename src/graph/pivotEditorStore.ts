// The open Pivot-editor popup (Excel-style field pane), or null. The popup edits
// the live node instance directly (mutate + processGraph).
import { createValueStore } from "./storeKit";
import type { PivotNode } from "./rete-nodes";

export interface PivotEditorState {
  node: PivotNode;
  nodeId: string;
  title: string;
  /** Resolved host `--node-accent`, so the popup header matches its node. */
  accent?: string;
}

export const pivotEditor = createValueStore<PivotEditorState>();
