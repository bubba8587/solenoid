import { reportStore } from "../reportStore";
import { documentSourceNode } from "../documentSource";
import type { DocumentValue } from "../documentValue";
import { stopDragStart } from "../coarse";

/** A DocumentValue's chip: click opens its SOURCE in the document panel — a Report
 *  to edit, a Note (plain or Obsidian) to read. A collapsed Dashboard wears the same chip for its board. */
export function DocumentChip({ value, size = "md", label = "Document", onOpen }: {
  value?: DocumentValue;
  size?: "sm" | "md";
  label?: string;
  /** What a click opens instead of the value's source: a Dashboard's board. */
  onOpen?: () => void;
}) {
  const src = value ? documentSourceNode(value.sourceId) : null;
  const open = onOpen ?? (src ? () => reportStore.open(src.id) : undefined);
  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--document${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={open ? `${label}. Open it.` : label}
      disabled={!open}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={open ? (e) => { e.stopPropagation(); open(); } : undefined}
    >
      {label}
    </button>
  );
}
