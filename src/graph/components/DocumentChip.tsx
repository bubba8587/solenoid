import { getOwningEditor } from "../activeGraph";
import { reportStore } from "../reportStore";
import { flyToNode } from "../flyToNode";
import { ReportNode } from "../nodes/report";
import type { DocumentValue } from "../documentValue";
import { stopDragStart } from "../coarse";

/** A DocumentValue's chip: click opens its SOURCE — a Report's overlay, or a
 *  fly-to for a Note, whose card IS the document and has no overlay. */
export function DocumentChip({ value, size = "md" }: { value: DocumentValue; size?: "sm" | "md" }) {
  const src = value.sourceId ? getOwningEditor(value.sourceId)?.getNode(value.sourceId) : undefined;
  const isReport = src instanceof ReportNode;
  const open = src
    ? () => (isReport ? reportStore.open(src.id) : flyToNode(src.id))
    : undefined;
  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--document${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={!open ? "Document" : isReport ? "Document. Open the report." : "Document. Go to its note."}
      disabled={!open}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={open ? (e) => { e.stopPropagation(); open(); } : undefined}
    >
      Document
    </button>
  );
}
