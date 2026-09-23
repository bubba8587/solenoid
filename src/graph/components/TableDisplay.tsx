// [[C24]] arraySemantics, [[C94]] formatFamilyGates, [[C44]] dateSerials, [[C58]] tableInputRawText
import { useSyncExternalStore } from "react";
import { ArrayChip, type ElemFamily } from "./ArrayChip";
import { CategoryChip } from "./CategoryChip";
import { categoryColorIndex } from "../categoryColor";
import type { TablePopupState } from "../tablePopupStore";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { extremeSci } from "./format";
import { useHostNodeId } from "./nodeContext";
import { resolveDisplayAnnotation } from "./valueDisplayFormat";
import {
  formatAnnotationStore, formatNumberWithAnnotation, applyLogicalStyle, applyTextCase,
  type FormatAnnotation,
} from "../formatAnnotationStore";
import type { ResultType } from "../nodes/shared";

type Cell = number | string | boolean | null | SolError;
type Mat = Cell[][];

function fmtNum(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "-∞";
  const sci = extremeSci(v);
  if (sci !== null) return sci;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
}

function isNanCell(v: Cell): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

export function formatTableCell(v: Cell, dateLike: boolean, ann?: FormatAnnotation): string {
  if (v === null) return "";
  if (isSolError(v)) return v.code;
  if (typeof v === "boolean") return applyLogicalStyle(v, ann?.logicalStyle);
  if (typeof v === "string") return ann ? applyTextCase(v, ann.textCase) : v;
  if (ann) return formatNumberWithAnnotation(v, ann);
  if (dateLike && Number.isFinite(v)) return formatDateSerial(v, DEFAULT_DATE_FORMAT);
  return fmtNum(v);
}

export function TableDisplay({ table, label, full, kind, elem, ann: annProp, popupOverrides, peek }: {
  table: Mat | SolError | null;
  label?: string;
  peek?: boolean;
  /** The socket-declared element family: pass `"number"` for a concretely numeric matrix. */
  elem: ElemFamily | undefined;
  popupOverrides?: Partial<TablePopupState>;
  full?: boolean;
  kind?: ResultType;
  ann?: FormatAnnotation;
}) {
  const hostId = useHostNodeId();
  const hostAnn = useSyncExternalStore(formatAnnotationStore.subscribe, () => resolveDisplayAnnotation(hostId));
  const ann = annProp ?? hostAnn;

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
    if (popupOverrides) {
      return (
        <div className="solenoid-node__display-value solenoid-table-display" style={{ padding: "4px 8px", userSelect: "text" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>empty</div>
          <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
            <ArrayChip value={[[0]]} label={label} size="sm" elem={elem} popupOverrides={popupOverrides} />
          </div>
        </div>
      );
    }
    return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  }
  const rows = table.length, cols = table[0]?.length ?? 0;
  const maxR = full ? rows : Math.min(rows, peek ? 5 : 4), maxC = full ? cols : Math.min(cols, 4);
  const dateLike = kind === "date" || elem === "date";
  const chipMap = ann?.chip ? categoryColorIndex(table.flat().map((v) => (typeof v === "string" ? v : null))) : null;

  return (
    <div className="solenoid-node__display-value solenoid-table-display" style={{ padding: "4px 8px", userSelect: "text" }}>
      <table className="solenoid-table-display__grid" style={{ borderCollapse: "collapse", width: "100%", tableLayout: full ? "auto" : "fixed" }}>
        <tbody>
          {table.slice(0, maxR).map((row, i) => (
            <tr key={i}>
              {row.slice(0, maxC).map((v, j) => {
                const nan = isNanCell(v);
                return (
                <td key={j} className={nan ? "solenoid-nan-cell" : undefined} title={nan ? "Not a number: an undefined value in the data" : undefined} style={{ padding: full ? "2px 7px" : "1px 3px", textAlign: typeof v === "string" ? "left" : "right", fontSize: full ? 13 : 12, fontFamily: "var(--font-mono)", color: "var(--text)", borderRight: "1px solid var(--border)", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {chipMap && typeof v === "string"
                    ? <CategoryChip value={v} index={chipMap.get(v) ?? 0} />
                    : formatTableCell(v, dateLike, ann)}
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
      {!full && !peek && (
        <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
          <ArrayChip value={table} label={label} size="sm" elem={elem} popupOverrides={popupOverrides} />
        </div>
      )}
    </div>
  );
}
