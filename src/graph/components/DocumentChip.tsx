import { getOwningEditor } from "../activeGraph";
import { reportStore } from "../reportStore";
import { NoteNode, ReportNode } from "../rete-nodes";
import type { DocumentValue } from "../documentValue";
import { stopDragStart } from "../coarse";

/** A DocumentValue's chip: click opens its SOURCE in the document panel — a Report
 *  to edit, a Note (plain or Obsidian) to read. */
export function DocumentChip({ value, size = "md" }: { value: DocumentValue; size?: "sm" | "md" }) {
  const src = value.sourceId ? getOwningEditor(value.sourceId)?.getNode(value.sourceId) : undefined;
  const open = src instanceof ReportNode || src instanceof NoteNode
    ? () => reportStore.open(src.id)
    : undefined;
  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--document${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={open ? "Document. Open it." : "Document"}
      disabled={!open}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={open ? (e) => { e.stopPropagation(); open(); } : undefined}
    >
      Document
    </button>
  );
}
