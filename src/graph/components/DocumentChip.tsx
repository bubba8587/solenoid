import { getOwningEditor } from "../activeGraph";
import { reportStore } from "../reportStore";
import { flyToNode } from "../flyToNode";
import { ReportNode } from "../nodes/report";
import type { DocumentValue } from "../documentValue";

/**
 * The compact "[Document]" chip — a DocumentValue's stand-in in a value box
 * (the document analogue of ChartChip). Click opens the value's SOURCE: a
 * Report's full overlay, or a fly-to for a Note (which has no overlay — the
 * card IS the document). A document with no live source (a stale value mid-
 * rebuild) renders as a plain, non-clickable chip.
 */
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
      title={!open ? "Document" : isReport ? "Document. Click to open the report." : "Document. Click to go to its note."}
      disabled={!open}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={open ? (e) => { e.stopPropagation(); open(); } : undefined}
    >
      Document
    </button>
  );
}
