// [[C24]] arraySemantics, [[D41]] formatFlowsDownstream, [[D43]] unitByGranularity
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
import { elemFamilyOfCells, elemChipClass, type ElemFamily } from "../valuePopup";
import { errorTip } from "./ErrorChip";
import { cellImageSrc } from "../recordLayout";
import "./ArrayChip.css";

/** A text cell holding a data:image picture ([[D83]] imageTextCells). */
export function CellImage({ src }: { src: string }): ReactNode {
  return <img className="sol-cell-img" src={src} alt="" draggable={false} />;
}

const LIST_PREVIEW = 3;
const HOVER_PREVIEW = 8;
function listToken(cell: unknown[], max = LIST_PREVIEW, type?: FrameColType): string {
  if (Array.isArray(cell[0])) return `[${cell.length}×${(cell[0] as unknown[]).length} Table]`;
  const items = cell.slice(0, max).map((x) => cubeCellToken(x as CubeCell, type));
  return `[${items.join(", ")}${cell.length > max ? "…" : ""}]`;
}

function listFamily(cell: unknown[], type?: FrameColType): ElemFamily | undefined {
  return type ?? elemFamilyOfCells(cell as Parameters<typeof elemFamilyOfCells>[0]);
}

export function cubeCellToken(cell: CubeCell, type?: FrameColType, format?: FormatAnnotation): string {
  if (cell === null || cell === undefined) return "";
  if (isCubeValue(cell)) return `[${cubeRowCount(cell)}×${cell.columns.length}×${cubeDepth(cell)} Cube]`;
  if (isFrameValue(cell)) return `[${frameRowCount(cell)}×${cell.columns.length} Frame]`;
  if (isUnitCell(cell)) return formatListCell(cell, formatScalar);
  if (Array.isArray(cell)) return listToken(cell, LIST_PREVIEW, type);
  if (isSolError(cell)) return cell.code;
  if (type) { const f = formatFrameCell(type, cell, format); return f === null ? "" : String(f); }
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (typeof cell === "number") return formatScalar(cell);
  return String(cell);
}

export function frameCellNode(type: FrameColType, cell: FrameCell, format?: FormatAnnotation): ReactNode {
  if (cell === null || cell === undefined || cell === "") {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  if (isSolError(cell)) {
    return <span title={errorTip(cell)} style={{ color: "var(--sol-error)" }}>{cell.code}</span>;
  }
  const img = cellImageSrc(cell);
  if (img) return <CellImage src={img} />;
  const f = formatFrameCell(type, cell, format);
  return <>{f === null ? "" : String(f)}</>;
}

export function CubeCellChip({ cell, crumb, size = "md", type, format, at }: {
  cell: CubeCell;
  crumb: string;
  at?: CellRef;
  size?: "sm" | "md";
  type?: FrameColType;
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
    const famClass = elemChipClass(cell as Parameters<typeof elemChipClass>[0], is2D, listFamily(cell, type));
    return (
      <button
        type="button"
        className={chip("array") + famClass}
        title={is2D ? `${cell.length}×${(cell[0] as unknown[]).length} table. Drill in.` : `${cell.length}-item list ${listToken(cell, HOVER_PREVIEW, type)}. Drill in.`}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => { stop(e); cubePopup.drill(is2D ? { kind: "grid", cells: cell as CubeCell[][], label: crumb } : { kind: "list", items: cell, label: crumb, type }, at); }}
      >
        [{is2D ? `${cell.length}×${(cell[0] as unknown[]).length} Table` : `${cell.length}× List`}]
      </button>
    );
  }
  if (isSolError(cell)) {
    return <span title={errorTip(cell)} style={{ color: "var(--sol-error)" }}>{cell.code}</span>;
  }
  if (isUnitCell(cell)) return <>{formatListCell(cell, formatScalar)}</>;
  if (type) return frameCellNode(type, cell, format);
  if (typeof cell === "boolean") return <>{cell ? "TRUE" : "FALSE"}</>;
  if (typeof cell === "number") return <>{formatScalar(cell)}</>;
  const img = cellImageSrc(cell);
  return img ? <CellImage src={img} /> : <>{String(cell)}</>;
}
