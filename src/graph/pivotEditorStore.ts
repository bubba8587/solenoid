// The open Pivot-editor popup (Excel-style field pane), or null. Module store
// (not React context): it's opened from inside the Pivot node, which Rete renders
// in a separate React root, so the popup is mounted once in App and reads this
// store. Mirrors tablePopup / formulaPopup. The popup edits the live node instance
// directly (mutate + processGraph), so the state just carries that node.
import { createValueStore } from "./storeKit";
import type { PivotNode } from "./rete-nodes";

export interface PivotEditorState {
  /** The live Pivot node being configured — the popup mutates it + reprocesses. */
  node: PivotNode;
  /** Host node id (for the header). */
  nodeId: string;
  /** Header label (the node's name). */
  title: string;
  /** Resolved accent color (the host node's `--node-accent`) so the popup header
   *  matches the node it opened from. */
  accent?: string;
}

export const pivotEditor = createValueStore<PivotEditorState>();
