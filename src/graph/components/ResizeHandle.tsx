/**
 * Resize handles are temporarily disabled — the drag wasn't reliable enough on
 * touch and needs a rethink. The component is a no-op for now so nothing renders
 * a grip; persisted node sizes (from before) still apply via NodeCard.
 *
 * To bring them back, restore the full implementation from git
 * (commit 6f7ccbd — module-level drag state + window listeners).
 */
export function ResizeHandle(_props: { nodeId: string }) {
  return null;
}
