// Shared rendering for a single Cube cell — used by the nested-data viewer's grid.
// A cell can be anything (the recursive value model), so this is the one place that
// maps each cell kind to how it shows + what drilling into it pushes onto the
// breadcrumb stack (every nested container drills IN PLACE — no second popup):
//   scalar / null / error  → inline text (no drill)
//   Frame                  → "R×C Frame" chip → drills a frame view
//   list / matrix          → "List n" / "n×m" chip → drills a grid view
//   Cube                   → "R×C×D Cube" chip → drills a cube view
import type { ReactNode } from "react";
import {
  isFrameValue, isCubeValue, cubeRowCount, cubeDepth, frameRowCount, formatFrameCell,
  type CubeCell, type FrameValue, type CubeValue, type FrameColType, type FrameCell,
} from "../frame";
import { isSolError } from "../errorValue";
import { isUnitCell } from "../unitValue";
import { cubePopup } from "../cubePopupStore";
import { formatScalar } from "./format";
import { formatListCell } from "./valueDisplayFormat";
import { errorTip } from "./ErrorChip";
import "./ArrayChip.css";

/** A short, drill-free token for the compact preview (no click). `type` (the source
 *  frame column's element type, carried onto the cube column) renders a flat scalar
 *  cell correctly — a date serial as a date, a logical as TRUE/FALSE. */
export function cubeCellToken(cell: CubeCell, type?: FrameColType): string {
  if (cell === null || cell === undefined) return "";
  if (isCubeValue(cell)) return `Cube ${cubeRowCount(cell)}x${cell.columns.length}x${cubeDepth(cell)}`;
  if (isFrameValue(cell)) return `Frame ${frameRowCount(cell)}x${cell.columns.length}`;
  if (isUnitCell(cell)) return formatListCell(cell, formatScalar); // "5 km"
  if (Array.isArray(cell)) return Array.isArray(cell[0]) ? `${cell.length}x${(cell[0] as unknown[]).length}` : `List ${cell.length}`;
  if (isSolError(cell)) return cell.code;
  // A typed flat cell (from a source frame column): render by its type.
  if (type) { const f = formatFrameCell(type, cell as FrameCell); return f === null ? "" : String(f); }
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (typeof cell === "number") return formatScalar(cell);
  return String(cell);
}

/** Render a flat Frame cell (no nesting — frame cells are scalars) by column type:
 *  a date serial → date string, a logical → TRUE/FALSE, an error → red #CODE!. */
export function frameCellNode(type: FrameColType, cell: FrameCell): ReactNode {
  if (cell === null || cell === undefined || cell === "") {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  if (isSolError(cell)) {
    return <span title={errorTip(cell)} style={{ color: "var(--error, #d33)" }}>{cell.code}</span>;
  }
  const f = formatFrameCell(type, cell);
  return <>{f === null ? "" : String(f)}</>;
}

/** A drillable cell for the viewer grid (cube + grid views). A nested container
 *  drills IN PLACE via the breadcrumb stack; a scalar renders as inline text. */
export function CubeCellChip({ cell, crumb, size = "md", type }: {
  cell: CubeCell;
  /** Breadcrumb label a drilled-into view should carry (the column name). */
  crumb: string;
  size?: "sm" | "md";
  /** The source frame column's element type (a flat scalar cell renders by it). */
  type?: FrameColType;
}): ReactNode {
  if (cell === null || cell === undefined) {
    return <span className="solenoid-node__text-empty" style={{ color: "var(--text-muted)" }}>—</span>;
  }
  // Per-kind chip colour (see ArrayChip.css): cube/frame violet, list/grid gold.
  const chip = (mod: "cube" | "frame" | "array") =>
    `solenoid-array-chip solenoid-array-chip--${mod}${size === "sm" ? " solenoid-array-chip--sm" : ""}`;
  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  if (isCubeValue(cell)) {
    const c = cell as CubeValue;
    return (
      <button
        type="button"
        className={chip("cube")}
        title={`Cube ${cubeRowCount(c)}×${c.columns.length}×${cubeDepth(c)} (rows × cols × depth). Click to drill in.`}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => { stop(e); cubePopup.drill({ kind: "cube", cube: c, label: crumb }); }}
      >
        [{cubeRowCount(c)}×{c.columns.length}×{cubeDepth(c)} Cube]
      </button>
    );
  }
  if (isFrameValue(cell)) {
    const f = cell as FrameValue;
    return (
      <button
        type="button"
        className={chip("frame")}
        title={`Frame ${frameRowCount(f)}×${f.columns.length}. Click to drill in.`}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => { stop(e); cubePopup.drill({ kind: "frame", frame: f, label: crumb }); }}
      >
        [{frameRowCount(f)}×{f.columns.length} Frame]
      </button>
    );
  }
  if (Array.isArray(cell)) {
    const is2D = Array.isArray(cell[0]);
    return (
      <button
        type="button"
        className={chip("array")}
        title="Click to drill in"
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => { stop(e); cubePopup.drill({ kind: "grid", cells: (is2D ? cell : [cell]) as CubeCell[][], label: crumb }); }}
      >
        [{is2D ? `${cell.length}×${(cell[0] as unknown[]).length}` : `List ${cell.length}`}]
      </button>
    );
  }
  if (isSolError(cell)) {
    return <span title={errorTip(cell)} style={{ color: "var(--error, #d33)" }}>{cell.code}</span>;
  }
  if (isUnitCell(cell)) return <>{formatListCell(cell, formatScalar)}</>; // "5 km"
  // A typed flat cell (from a source frame column): render by its type — a date
  // serial as a date, a logical as TRUE/FALSE (frameCellNode shares the frame path).
  if (type) return frameCellNode(type, cell as FrameCell);
  if (typeof cell === "boolean") return <>{cell ? "TRUE" : "FALSE"}</>;
  if (typeof cell === "number") return <>{formatScalar(cell)}</>;
  return <>{String(cell)}</>;
}
