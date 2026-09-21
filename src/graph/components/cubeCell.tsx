// [[C24]] arraySemantics, [[D41]] formatFlowsDownstream, [[D43]] unitByGranularity
// The one place mapping a Cube cell's kind to how it renders and what drilling it
// pushes onto the breadcrumb stack — a nested container drills IN PLACE.
import type { ReactNode } from "react";
import {
  isFrameValue, isCubeValue, cubeRowCount, cubeDepth, frameRowCount, formatFrameCell,
  type CubeCell, type FrameColType, type FrameCell,
} from "../frame";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { isSolError } from "../errorValue";
import { isUnitCell } from "../unitValue";
import { cubePopup, type CellRef } from "../cubePopupStore";
import { formatScalar } from "./format";
import { formatListCell } from "./valueDisplayFormat";
import { elemFamilyOfCells, type ElemFamily } from "../valuePopup";
import { errorTip } from "./ErrorChip";
import "./ArrayChip.css";

const LIST_PREVIEW = 3;
/** The hover title shows more of a list than the compact token does. */
const HOVER_PREVIEW = 8;
/** A list cell in brackets with its first `max` items (`[a, b, c…]`); a 2-D cell by
 *  its shape (`[3×4 Table]`), like the chips. */
function listToken(cell: unknown[], max = LIST_PREVIEW, type?: FrameColType): string {
  if (Array.isArray(cell[0])) return `[${cell.length}×${(cell[0] as unknown[]).length} Table]`;
  // The column's element type prints each item (a date list's serials as dates).
  const items = cell.slice(0, max).map((x) => cubeCellToken(x as CubeCell, type));
  return `[${items.join(", ")}${cell.length > max ? "…" : ""}]`;
}

/** The element family a nested list chip tints by: the column's declared type when the
 *  cube carries one, else the cells (a mixed list stays untinted, like a wildcard). */
function listFamily(cell: unknown[], type?: FrameColType): ElemFamily | undefined {
  return type ?? elemFamilyOfCells(cell as Parameters<typeof elemFamilyOfCells>[0]);
}

/** A short, drill-free token for the compact preview, spelled like the chips
 *  (`[3×2×1 Cube]`, `[5×2 Frame]`, `[a, b, c…]`); `type` renders a flat scalar cell by
 *  its source column's element type. */
export function cubeCellToken(cell: CubeCell, type?: FrameColType, format?: FormatAnnotation): string {
  if (cell === null || cell === undefined) return "";
  if (isCubeValue(cell)) return `[${cubeRowCount(cell)}×${cell.columns.length}×${cubeDepth(cell)} Cube]`;
  if (isFrameValue(cell)) return `[${frameRowCount(cell)}×${cell.columns.length} Frame]`;
  if (isUnitCell(cell)) return formatListCell(cell, formatScalar); // "5 km"
  if (Array.isArray(cell)) return listToken(cell, LIST_PREVIEW, type);
  if (isSolError(cell)) return cell.code;
  if (type) { const f = formatFrameCell(type, cell, format); return f === null ? "" : String(f); }
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (typeof cell === "number") return formatScalar(cell);
  return String(cell);
}

/** A flat Frame cell by column type: serial → date, logical → TRUE/FALSE, error →
 *  red #CODE!. */
export function frameCellNode(type: FrameColType, cell: FrameCell, format?: FormatAnnotation): ReactNode {
  if (cell === null || cell === undefined || cell === "") {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  if (isSolError(cell)) {
    return <span title={errorTip(cell)} style={{ color: "var(--error, #d33)" }}>{cell.code}</span>;
  }
  const f = formatFrameCell(type, cell, format);
  return <>{f === null ? "" : String(f)}</>;
}

/** A drillable cell for the viewer grid (cube + grid views). A nested container
 *  drills IN PLACE via the breadcrumb stack; a scalar renders as inline text. */
export function CubeCellChip({ cell, crumb, size = "md", type, format, at }: {
  cell: CubeCell;
  /** Breadcrumb label a drilled-into view should carry (the column name). */
  crumb: string;
  /** This chip's cell in the popup grid, so a return from the drilled level lands on it. */
  at?: CellRef;
  size?: "sm" | "md";
  /** The source frame column's element type (a flat scalar cell renders by it). */
  type?: FrameColType;
  /** The source column's display format (a date cell renders by its pattern). */
  format?: FormatAnnotation;
}): ReactNode {
  if (cell === null || cell === undefined) {
    return <span className="solenoid-node__text-empty" style={{ color: "var(--text-muted)" }}>—</span>;
  }
  const chip = (mod: "cube" | "frame" | "array") =>
    `solenoid-array-chip solenoid-array-chip--${mod}${size === "sm" ? " solenoid-array-chip--sm" : ""}`;
  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  if (isCubeValue(cell)) {
    const c = cell;
    return (
      <button
        type="button"
        className={chip("cube")}
        title={`Cube ${cubeRowCount(c)}×${c.columns.length}×${cubeDepth(c)} (rows × cols × depth). Drill in.`}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => { stop(e); cubePopup.drill({ kind: "cube", cube: c, label: crumb }, at); }}
      >
        [{cubeRowCount(c)}×{c.columns.length}×{cubeDepth(c)} Cube]
      </button>
    );
  }
  if (isFrameValue(cell)) {
    const f = cell;
    return (
      <button
        type="button"
        className={chip("frame")}
        title={`Frame ${frameRowCount(f)}×${f.columns.length}. Drill in.`}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => { stop(e); cubePopup.drill({ kind: "frame", frame: f, label: crumb }, at); }}
      >
        [{frameRowCount(f)}×{f.columns.length} Frame]
      </button>
    );
  }
  if (Array.isArray(cell)) {
    const is2D = Array.isArray(cell[0]);
    // Tinted by element family like the node-level chip (numeric keeps the default).
    const family = listFamily(cell, type);
    const famClass = family && family !== "number" ? ` solenoid-array-chip--elem-${family}${is2D ? "-table" : ""}` : "";
    return (
      <button
        type="button"
        className={chip("array") + famClass}
        title={is2D ? `${cell.length}×${(cell[0] as unknown[]).length} table. Drill in.` : `${cell.length}-item list ${listToken(cell, HOVER_PREVIEW, type)}. Drill in.`}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => { stop(e); cubePopup.drill(is2D ? { kind: "grid", cells: cell as CubeCell[][], label: crumb } : { kind: "list", items: cell, label: crumb }, at); }}
      >
        [{is2D ? `${cell.length}×${(cell[0] as unknown[]).length} Table` : `${cell.length}× List`}]
      </button>
    );
  }
  if (isSolError(cell)) {
    return <span title={errorTip(cell)} style={{ color: "var(--error, #d33)" }}>{cell.code}</span>;
  }
  if (isUnitCell(cell)) return <>{formatListCell(cell, formatScalar)}</>; // "5 km"
  if (type) return frameCellNode(type, cell, format);
  if (typeof cell === "boolean") return <>{cell ? "TRUE" : "FALSE"}</>;
  if (typeof cell === "number") return <>{formatScalar(cell)}</>;
  return <>{String(cell)}</>;
}
