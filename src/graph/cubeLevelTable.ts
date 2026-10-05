// [[C114]] cardsView
import type { DrillView } from "./cubePopupStore";
import { cubeRowCount, frameRowCount, isCubeValue, isFrameValue, type CubeCell, type FrameColType } from "./frame";
import type { FormatAnnotation } from "./formatAnnotationStore";
import { isUnitCell } from "./unitValue";
import { displayMagnitudeOf } from "./unitBridge";

export interface LevelColumn {
  name: string;
  /** The declared type, else the one the plain cells agree on, else text. */
  type: FrameColType;
  /** The declared type, which a cell renders by; undefined when inferred. */
  declared?: FrameColType;
  format?: FormatAnnotation;
  cells: readonly CubeCell[];
  /** Every filled cell is a list, table, Frame or Cube; `lists` when every one is a flat list. */
  nested: boolean;
  lists: boolean;
}

export const isContainer = (v: unknown): boolean => Array.isArray(v) || isCubeValue(v) || isFrameValue(v);
const isFlatList = (v: unknown): boolean => Array.isArray(v) && !v.some((x) => Array.isArray(x));

function shapeOf(cells: readonly CubeCell[]): { nested: boolean; lists: boolean } {
  const filled = cells.filter((v) => v != null && v !== "");
  const nested = filled.length > 0 && filled.every(isContainer);
  return { nested, lists: nested && filled.every(isFlatList) };
}

function inferType(cells: readonly CubeCell[]): FrameColType {
  const filled = cells.filter((v) => v != null && v !== "");
  if (filled.length === 0) return "string";
  if (filled.every((v) => typeof v === "number" || isUnitCell(v))) return "number";
  if (filled.every((v) => typeof v === "boolean")) return "logical";
  return "string";
}

/** A cube or frame level's columns, padded to its row count; null for a list or grid level, which has no Cards or footer. */
export function cubeLevelColumns(view: DrillView): { rows: number; columns: LevelColumn[] } | null {
  if (view.kind === "cube") {
    const rows = cubeRowCount(view.cube);
    return {
      rows,
      columns: view.cube.columns.map((c) => {
        const cells = Array.from({ length: rows }, (_, r) => c.cells[r] ?? null);
        return { name: c.name, type: c.type ?? inferType(cells), declared: c.type, format: c.format, cells, ...shapeOf(cells) };
      }),
    };
  }
  if (view.kind === "frame") {
    const rows = frameRowCount(view.frame);
    return {
      rows,
      columns: view.frame.columns.map((c) => ({
        name: c.name, type: c.type, declared: c.type, format: c.format,
        cells: Array.from({ length: rows }, (_, r) => (c.values[r] ?? null) as CubeCell),
        nested: false, lists: false,
      })),
    };
  }
  return null;
}

/** A column's cells as the footer statistics read them: a unit cell as the number it shows, a nested container as a filled non-number. */
export function statValues(col: LevelColumn): unknown[] {
  return col.cells.map((v) => (isUnitCell(v) ? displayMagnitudeOf(v) : v));
}
