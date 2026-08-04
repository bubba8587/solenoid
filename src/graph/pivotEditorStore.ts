// The open Pivot-editor popup (Excel-style field pane), or null. The popup edits
// the live node instance directly (mutate + processGraph).
import { createValueStore } from "./storeKit";
import type { PivotNode } from "./rete-nodes";

export interface PivotEditorState {
  /** The live Pivot node being configured — the popup mutates it + reprocesses. */
  node: PivotNode;
  nodeId: string;
  title: string;
  /** Resolved accent color (the host node's `--node-accent`) so the popup header
   *  matches the node it opened from. */
  accent?: string;
}

export const pivotEditor = createValueStore<PivotEditorState>();
