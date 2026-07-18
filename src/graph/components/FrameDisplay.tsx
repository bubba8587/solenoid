// Compact frame preview — header names + up to 3×4 cells, then a chip. Mirrors
// TableDisplay (same classes) so the collapse-to-chip CSS applies unchanged.
import { useSyncExternalStore } from "react";
import { FrameChip } from "./FrameChip";
import { frameRowCount, formatFrameCell, type FrameCell, type FrameColType, type FrameValue, type FrameSourceColumn } from "../frame";
import type { FramePopupColumn } from "../tablePopupStore";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { useHostNodeId } from "./nodeContext";
import { frameFormatStore } from "../frameFormatStore";
import { formatNumberWithAnnotation, applyLogicalStyle, applyTextCase, isDateStyle, type FormatAnnotation } from "../formatAnnotationStore";

// A NaN cell is dirty DATA (an undefined value from an import), not the #N/A
// error — render the literal "NaN", tinted at the cell (see the td below).
function isNanCell(v: FrameCell): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

function fmtCell(v: FrameCell, type: FrameColType = "number", ann?: FormatAnnotation): string {
  // A persisted per-column format (frameFormatStore) applies by column KIND — a
  // logical show-as, or a number/date format. A stale cross-type format left by a
  // type switch (number↔date) is ignored (guards against a number rendering as a
  // date), falling through to the type's default below.
  if (ann) {
    if (type === "logical" && typeof v === "boolean") return applyLogicalStyle(v, ann.logicalStyle);
    if (typeof v === "number" && Number.isFinite(v) && (type === "date") === isDateStyle(ann.format)) {
      return formatNumberWithAnnotation(v, { ...ann, unit: "none" });
    }
  }
  const c = formatFrameCell(type, v); // date serials → date strings
  if (c === null || c === undefined || c === "") return "";
  if (typeof c === "string") return type === "string" ? applyTextCase(c, ann?.textCase) : c;
  if (Number.isNaN(c)) return "NaN";
  if (!Number.isFinite(c)) return c > 0 ? "∞" : "-∞";
  return Number.isInteger(c) ? String(c) : c.toFixed(3).replace(/\.?0+$/, "");
}

export function FrameDisplay({ frame, label, onSave, source, onSaveSource, full, previewRows, previewCols, scroll, formatNodeId }: {
  frame: FrameValue | SolError | null;
  label?: string;
  /** Override the node whose persisted per-column formats to read (frameFormatStore).
   *  Defaults to the host node from context. A Report embed passes the SOURCE frame
   *  node's id so an embedded frame shows the format set on that frame, not the
   *  Report's. */
  formatNodeId?: string;
  /** When set, the chip opens the grid editable (Frame Input) and Save writes
   *  back through this with the edited typed columns. */
  onSave?: (columns: FramePopupColumn[]) => void;
  /** Literal-source editing (Frame Input): the editor seeds from / saves the RAW
   *  text, deriving the typed value downstream. Takes precedence over `onSave`. */
  source?: FrameSourceColumn[];
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  /** Render the whole frame (no 3×4 cap, no chip) — for the Display node, whose
   *  box scrolls when resized. Default is the compact preview. */
  full?: boolean;
  /** Override the compact row cap (default 3). The Report shows many more rows —
   *  a document isn't a cramped node hero box — in a scrollable box (see `scroll`). */
  previewRows?: number;
  /** Override the compact column cap (default 3). */
  previewCols?: number;
  /** Cap the table height and scroll past it, so a tall preview doesn't run the
   *  whole document. Keeps the chip (opens the full popup). */
  scroll?: boolean;
}) {
  // Per-column persisted formats live on the host node (frameFormatStore). Subscribe
  // so a format change in the popup re-renders this preview. A Report embed overrides
  // the node id with the referenced frame's source node.
  const ctxNodeId = useHostNodeId();
  const hostNodeId = formatNodeId ?? ctxNodeId;
  useSyncExternalStore(frameFormatStore.subscribe, frameFormatStore.version);
  const annFor = (colName: string): FormatAnnotation | undefined =>
    hostNodeId ? frameFormatStore.get(hostNodeId, colName) : undefined;

  if (isSolError(frame)) {
    return (
      <div
        className={`solenoid-node__display-value solenoid-node__display-value--error${frame.origin ? " sol-error-chip--clickable" : ""}`}
        title={errorTip(frame)}
        onClick={frame.origin ? () => flyToNode(frame.origin!.nodeId) : undefined}
        onPointerDown={frame.origin ? (e) => e.stopPropagation() : undefined}
        onMouseDown={frame.origin ? (e) => e.stopPropagation() : undefined}
      >
        {frame.code}
      </div>
    );
  }
  if (!frame || frame.columns.length === 0) {
    return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  }
  const rows = frameRowCount(frame);
  // Cap rendered rows even when "full": a Display node is an inline card, not a data
  // browser, so keep it small — 100 rows. The "…" row marks the cut; the chip opens
  // the popup (capped higher) for more, and both carry the true count.
  const maxR = full ? Math.min(rows, 100) : Math.min(rows, previewRows ?? 3);
  const maxC = full ? frame.columns.length : Math.min(frame.columns.length, previewCols ?? 3);
  const extraCols = !full && frame.columns.length > maxC;

  return (
    <div
      className="solenoid-node__display-value solenoid-table-display"
      style={{ padding: "4px 8px", userSelect: "text", ...(scroll ? { maxHeight: 260, overflow: "auto" } : null) }}
    >
      <table className="solenoid-table-display__grid" style={{ borderCollapse: "collapse", width: "100%", tableLayout: full ? "auto" : "fixed" }}>
        <thead>
          <tr>
            {frame.columns.slice(0, maxC).map((c, j) => (
              <th key={j} title={c.name} style={{ padding: full ? "2px 8px" : "1px 4px", textAlign: "left", fontSize: full ? 13 : 11, fontWeight: 600, color: "var(--node-accent, var(--text-dim))", borderRight: "1px solid var(--border)", whiteSpace: "nowrap", ...(full ? {} : { overflow: "hidden", textOverflow: "ellipsis" }) }}>
                {c.name}
              </th>
            ))}
            {extraCols && <th style={{ fontSize: 10, color: "var(--text-muted)", width: 14 }}>…</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxR }, (_, i) => (
            <tr key={i}>
              {frame.columns.slice(0, maxC).map((c, j) => {
                const cell = c.values[i] ?? null;
                const nan = isNanCell(cell);
                return (
                <td key={j} className={nan ? "solenoid-nan-cell" : undefined} title={nan ? "Not a number: an undefined value in the data" : undefined} style={{ padding: full ? "2px 8px" : "1px 4px", textAlign: c.type === "string" ? "left" : "right", fontSize: full ? 13 : 12, fontFamily: "var(--font-mono)", color: "var(--text)", borderRight: "1px solid var(--border)", whiteSpace: full ? "nowrap" : undefined, ...(full ? {} : { overflow: "hidden", textOverflow: "ellipsis" }) }}>
                  {fmtCell(cell, c.type, annFor(c.name))}
                </td>
                );
              })}
              {extraCols && <td style={{ color: "var(--text-muted)", fontSize: 10 }}>…</td>}
            </tr>
          ))}
          {rows > maxR && (
            <tr>
              <td colSpan={maxC + (extraCols ? 1 : 0)} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>…</td>
            </tr>
          )}
        </tbody>
      </table>
      {!full && (
        <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
          <FrameChip value={frame} label={label} size="sm" onSave={onSave} source={source} onSaveSource={onSaveSource} />
        </div>
      )}
    </div>
  );
}
