// [[D81]] cubeRowLists: a Cube as a row formula reads it.
import { inferColumn, typedColumn, isFrameValue, isCubeValue, type FrameColType, type CubeValue, type CubeColumn, type CubeCell } from "./frame";
import { isUnitCell, type ColumnUnit } from "./unitValue";
import { displayMagnitudeOf } from "./unitBridge";
import { solError } from "./errorValue";
import type { RowColumn } from "./computedColumnCore";


export interface CubeRowColumn extends RowColumn {
  type: FrameColType;
  unit?: ColumnUnit;
}

const isTableCell = (c: CubeCell): boolean => isFrameValue(c) || isCubeValue(c);
const itemMagnitude = (x: unknown): unknown => (isUnitCell(x) ? displayMagnitudeOf(x) : Array.isArray(x) ? x.map(itemMagnitude) : x);

function scalarRead(col: CubeColumn, rows: number): CubeRowColumn {
  const cells = Array.from({ length: rows }, (_, i) => col.cells[i] ?? null);
  const read = inferColumn(col.name, cells);
  if (!col.type || col.type === read.type) return read;
  if (col.type === "string") return typedColumn(col.name, cells.map((c) => (isUnitCell(c) ? displayMagnitudeOf(c) : c)), rows, "string");
  if (col.type === "date" && read.type === "number") return { ...read, type: "date" };
  return read;
}

/** Scalar columns read as typed columns, a column of lists reads each row's list (its whole is `#SHAPE!`), and a column holding tables reads `#SHAPE!`. */
export function cubeRowTable(cube: CubeValue): { columns: CubeRowColumn[] } {
  const rows = cube.columns.reduce((m, c) => Math.max(m, c.cells.length), 0);
  return {
    columns: cube.columns.map((col): CubeRowColumn => {
      if (col.cells.some(isTableCell)) {
        const err = solError("#SHAPE!", `"${col.name}" has table cells; a formula reads values and lists`);
        return { name: col.name, type: "string", values: col.cells.map(() => err) };
      }
      if (!col.cells.some(Array.isArray)) return scalarRead(col, rows);
      const values = Array.from({ length: rows }, (_, i) => itemMagnitude(col.cells[i] ?? null));
      const items = values.flatMap((v) => (Array.isArray(v) ? v.flat() : [v]));
      return {
        name: col.name,
        type: col.type ?? inferColumn(col.name, items).type,
        values,
        whole: solError("#SHAPE!", `"${col.name}" holds a list in each row. Use @${/^[A-Za-z_][\w.]*$/.test(col.name) ? col.name : `[${col.name}]`} to read this row's list.`),
      };
    }),
  };
}

/** The element type of a Cube computed column: a list column takes its items' type. */
export function cubeCellsType(cells: readonly CubeCell[]): FrameColType | null {
  if (!cells.some(Array.isArray)) return null;
  return inferColumn("", cells.flatMap((c) => (Array.isArray(c) ? (c as unknown[]).flat() : [c]))).type;
}
