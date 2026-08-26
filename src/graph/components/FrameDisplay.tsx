// Compact frame preview — header names + up to 3×4 cells, then a chip. Mirrors
// TableDisplay (same classes) so the collapse-to-chip CSS applies unchanged.
import { useSyncExternalStore } from "react";
import { FrameChip } from "./FrameChip";
import { frameRowCount, formatFrameCell, type FrameCell, type FrameColType, type FrameValue, type FrameSourceColumn } from "../frame";
import type { FramePopupColumn, SourceCommitRefresh } from "../tablePopupStore";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { useHostNodeId } from "./nodeContext";
import { frameFormatStore } from "../frameFormatStore";
import { formatNumberWithAnnotation, applyLogicalStyle, applyTextCase, isDateStyle, type FormatAnnotation } from "../formatAnnotationStore";

// A NaN cell is dirty DATA from an import, not the #N/A error, so it renders as a
// literal "NaN".
function isNanCell(v: FrameCell): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

function fmtCell(v: FrameCell, type: FrameColType = "number", ann?: FormatAnnotation): string {
  // A persisted format applies by column KIND, so a stale cross-type one left by a
  // number↔date switch falls through to the type default rather than misrendering.
  if (ann) {
    if (type === "logical" && typeof v === "boolean") return applyLogicalStyle(v, ann.logicalStyle);
    if (typeof v === "number" && Number.isFinite(v) && (type === "date") === isDateStyle(ann.format)) {
      return formatNumberWithAnnotation(v, { ...ann, unit: "none" });
    }
  }
  const c = formatFrameCell(type, v);
  if (c === null || c === undefined || c === "") return "";
  if (typeof c === "string") return type === "string" ? applyTextCase(c, ann?.textCase) : c;
  if (Number.isNaN(c)) return "NaN";
  if (!Number.isFinite(c)) return c > 0 ? "∞" : "-∞";
  return Number.isInteger(c) ? String(c) : c.toFixed(3).replace(/\.?0+$/, "");
}

export function FrameDisplay({ frame, label, onSave, source, onSaveSource, onCommitSource, full, previewRows, previewCols, scroll, formatNodeId, lambdaOptions, formLayout }: {
  frame: FrameValue | SolError | null;
  label?: string;
  /** Whose persisted per-column formats to read; defaults to the host node. A Report
   *  embed passes the SOURCE frame node so it shows that frame's formats. */
  formatNodeId?: string;
  /** When set, the chip opens the grid editable (Frame Input) and Save writes
   *  back through this with the edited typed columns. */
  onSave?: (columns: FramePopupColumn[]) => void;
  /** Literal-source editing (Frame Input): the editor seeds from / saves the RAW
   *  text, deriving the typed value downstream. Takes precedence over `onSave`. */
  source?: FrameSourceColumn[];
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  /** LIVE write-through for the column-source model — see tablePopupStore. */
  onCommitSource?: (columns: FrameSourceColumn[]) => Promise<SourceCommitRefresh | null>;
  /** Render the whole frame (no 3×4 cap, no chip). Default is the compact preview. */
  full?: boolean;
  /** Override the compact row cap (default 3). */
  previewRows?: number;
  /** Override the compact column cap (default 3). */
  previewCols?: number;
  /** A wide table scrolls sideways; never vertically, so the chip stays in view. */
  scroll?: boolean;
  /** The host's λ input keys — forwarded so the popup can offer the source select. */
  lambdaOptions?: string[];
  /** Form-view field placement (the Record layout text, authored on the card). */
  formLayout?: string;
}) {
  // Subscribe so a format change in the popup re-renders this preview.
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
  // Even "full" caps at 100 rows — a Display node is a card, not a data browser.
  const maxR = full ? Math.min(rows, 100) : Math.min(rows, previewRows ?? 3);
  const maxC = full ? frame.columns.length : Math.min(frame.columns.length, previewCols ?? 3);
  const extraCols = !full && frame.columns.length > maxC;

  return (
    <div
      className="solenoid-node__display-value solenoid-table-display"
      style={{ padding: "4px 8px", userSelect: "text", ...(scroll ? { overflowX: "auto" } : null) }}
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
          <FrameChip value={frame} label={label} size="sm" onSave={onSave} source={source} onSaveSource={onSaveSource} onCommitSource={onCommitSource} lambdaOptions={lambdaOptions} formLayout={formLayout} />
        </div>
      )}
    </div>
  );
}
