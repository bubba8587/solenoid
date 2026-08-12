import { ArrayChip, type ElemFamily } from "./ArrayChip";
import type { TablePopupState } from "../tablePopupStore";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { extremeSci } from "./format";
import type { ResultType } from "../nodes/shared";

// A polyform matrix cell: number (date serial included), text, logical, null, or SolError.
type Cell = number | string | boolean | null | SolError;
type Mat = Cell[][];

function fmtNum(v: number): string {
  if (Number.isNaN(v)) return "NaN"; // dirty data, not the #N/A error — tinted at the cell
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "-∞";
  const sci = extremeSci(v); // shared forced-scientific rule (format.ts)
  if (sci !== null) return sci;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
}

/** A NaN cell (dirty numeric data) — for the per-cell tint at the td. */
function isNanCell(v: Cell): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

/** Render one cell. Text passes through; a logical shows TRUE/FALSE; a date matrix
 *  formats its serials; everything else is numeric. */
function fmtCell(v: Cell, kind?: ResultType): string {
  if (v === null) return ""; // a missing cell renders blank
  if (isSolError(v)) return v.code; // a per-cell error shows its #CODE!
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"; // logical cell
  if (typeof v === "string") return v;
  if (kind === "date" && Number.isFinite(v)) return formatDateSerial(v, DEFAULT_DATE_FORMAT);
  return fmtNum(v);
}

export function TableDisplay({ table, label, onSave, full, kind, elem, popupOverrides }: {
  table: Mat | SolError | null;
  label?: string;
  /** When set, the chip opens the grid editable and Save writes back through this. */
  onSave?: (next: (number | null)[][]) => void;
  /** Element-family chip tint when the caller knows the socket family. */
  elem?: ElemFamily;
  /** Forwarded to the chip's popup open(): the grid edits source text, never derived. */
  popupOverrides?: Partial<TablePopupState>;
  /** Render the full matrix, no 4×4 cap and no chip; default is the compact preview. */
  full?: boolean;
  /** Drives text passthrough / date formatting of cells; omitted for numeric tables. */
  kind?: ResultType;
}) {
  // A SolError in cachedResult renders the same red #CODE! badge a scalar box shows.
  if (isSolError(table)) {
    return (
      <div
        className={`solenoid-node__display-value solenoid-node__display-value--error${table.origin ? " sol-error-chip--clickable" : ""}`}
        title={errorTip(table)}
        onClick={table.origin ? () => flyToNode(table.origin!.nodeId) : undefined}
        onPointerDown={table.origin ? (e) => e.stopPropagation() : undefined}
        onMouseDown={table.origin ? (e) => e.stopPropagation() : undefined}
      >
        {table.code}
      </div>
    );
  }
  if (!table || table.length === 0) {
    // An EDITABLE input must never lose its chip: text that parses to nothing would blank
    // the node to "—" and make it wholly uneditable.
    if (onSave || popupOverrides) {
      return (
        <div className="solenoid-node__display-value solenoid-table-display" style={{ padding: "4px 8px", userSelect: "text" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>empty</div>
          <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
            <ArrayChip value={[[0]]} label={label} size="sm" onSave={onSave} elem={elem} popupOverrides={popupOverrides} />
          </div>
        </div>
      );
    }
    return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  }
  const rows = table.length, cols = table[0]?.length ?? 0;
  const maxR = full ? rows : Math.min(rows, 4), maxC = full ? cols : Math.min(cols, 4);

  return (
    // The class lets the collapsed-node CSS hide the grid and keep only the chip.
    <div className="solenoid-node__display-value solenoid-table-display" style={{ padding: "4px 8px", userSelect: "text" }}>
      <table className="solenoid-table-display__grid" style={{ borderCollapse: "collapse", width: "100%", tableLayout: full ? "auto" : "fixed" }}>
        <tbody>
          {table.slice(0, maxR).map((row, i) => (
            <tr key={i}>
              {row.slice(0, maxC).map((v, j) => {
                const nan = isNanCell(v);
                return (
                <td key={j} className={nan ? "solenoid-nan-cell" : undefined} title={nan ? "Not a number: an undefined value in the data" : undefined} style={{ padding: full ? "2px 7px" : "1px 3px", textAlign: typeof v === "string" ? "left" : "right", fontSize: full ? 13 : 12, fontFamily: "var(--font-mono)", color: "var(--text)", borderRight: "1px solid var(--border)", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {fmtCell(v, kind)}
                </td>
                );
              })}
              {!full && cols > maxC && <td style={{ padding: "1px 3px", color: "var(--text-muted)", fontSize: 10, width: 14 }}>…</td>}
            </tr>
          ))}
          {!full && rows > maxR && (
            <tr>
              <td colSpan={maxC + (cols > maxC ? 1 : 0)} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>…</td>
            </tr>
          )}
        </tbody>
      </table>
      {!full && (
        <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
          <ArrayChip value={table} label={label} size="sm" onSave={onSave} elem={elem} popupOverrides={popupOverrides} />
        </div>
      )}
    </div>
  );
}
