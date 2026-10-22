// [[C22]] rowFormulaRefs: a Cube as a row formula reads it.
import { inferColumn, typedColumn, isFrameValue, isCubeValue, type FrameColType, type CubeValue, type CubeColumn, type CubeCell } from "./frame";
import { isUnitCell, unitError, type ColumnUnit } from "./unitValue";
import { displayMagnitudeOf } from "./unitBridge";
import { solError, isSolError, type SolError } from "./errorValue";
import { isDimensionless, dimEqual, formatDim, type Dim } from "./dimension";
import type { RowColumn } from "./computedColumnCore";


export interface CubeRowColumn extends RowColumn {
  type: FrameColType;
  unit?: ColumnUnit;
  /** The cells hold two dimensions, so a formula can't read the column in one unit. */
  unitError?: SolError;
}

const isTableCell = (c: CubeCell): boolean => isFrameValue(c) || isCubeValue(c);
const itemMagnitude = (x: unknown): unknown => (isUnitCell(x) ? displayMagnitudeOf(x) : Array.isArray(x) ? x.map(itemMagnitude) : x);
const itemBase = (x: unknown): unknown => (isUnitCell(x) ? x.value : Array.isArray(x) ? x.map(itemBase) : x);

type CellsUnit = { unit: ColumnUnit; base: boolean } | SolError | null;

/**
 * The one unit a column's cells share, list items included ([[D100]] computedColumnInfersUnit): a Cube
 * carries its unit per cell. Cells in one dimension but two display units share only the dimension and
 * read in base SI; two dimensions are #UNIT!.
 */
function cellsUnit(col: CubeColumn): CellsUnit {
  let dim: Dim | null = null;
  let display: string | undefined;
  let mixed = false;
  let clash: SolError | null = null;
  const visit = (c: unknown): void => {
    if (clash) return;
    if (Array.isArray(c)) { c.forEach(visit); return; }
    if (!isUnitCell(c) || isDimensionless(c.dim)) return;
    if (dim === null) { dim = c.dim; display = c.display; return; }
    if (!dimEqual(dim, c.dim)) clash = unitError(`${col.name} holds mixed units: ${formatDim(dim)} and ${formatDim(c.dim)}.`);
    else if (c.display !== display) mixed = true;
  };
  col.cells.forEach(visit);
  if (clash) return clash;
  if (dim === null) return null;
  return mixed || !display ? { unit: { dim }, base: true } : { unit: { dim, display }, base: false };
}

function withUnit(read: CubeRowColumn, u: CellsUnit): CubeRowColumn {
  const { unit: _read, ...plain } = read;
  if (u === null) return plain;
  return isSolError(u) ? { ...plain, unitError: u } : { ...plain, unit: u.unit };
}

function scalarRead(col: CubeColumn, rows: number, u: CellsUnit): CubeRowColumn {
  const cells = Array.from({ length: rows }, (_, i) => col.cells[i] ?? null);
  const read = inferColumn(col.name, cells);
  if (col.type === "string" && read.type !== "string") return typedColumn(col.name, cells.map((c) => (isUnitCell(c) ? displayMagnitudeOf(c) : c)), rows, "string");
  const typed: CubeRowColumn = col.type === "date" && read.type === "number" ? { ...read, type: "date" } : read;
  if (typed.type !== "number") return withUnit(typed, null);
  if (u && !isSolError(u) && u.base) {
    return withUnit({ ...typed, values: typed.values.map((v, i) => { const c = cells[i]; return isUnitCell(c) ? c.value : v; }) }, u);
  }
  return withUnit(typed, u);
}

const atRef = (name: string): string => `@${/^[A-Za-z_][\w.]*$/.test(name) ? name : `[${name}]`}`;

/**
 * A column of lists read whole is its rows stacked, one list per row, padded with blanks to the longest
 * ([[C22]] rowFormulaRefs, [[D85]] columnsStayColumns): a list is a row, so a column of them is a table.
 * A blank is no value here, so SUM and AVERAGE read only the items that exist.
 */
function stackedRows(col: CubeColumn, values: readonly unknown[]): unknown {
  if (values.some((v) => Array.isArray(v) && v.some(Array.isArray))) {
    return solError("#SHAPE!", `"${col.name}" holds a grid in a row, so it has no single table to read. Use ${atRef(col.name)} to read this row's.`);
  }
  const rows = values.map((v) => (Array.isArray(v) ? v : v === null ? [] : [v]));
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<unknown>(width - r.length).fill(null)]);
}

/** Scalar columns read as typed columns, a column of lists reads each row's list and whole as its stacked rows, and a row holding a table reads `#SHAPE!` on that row alone. */
export function cubeRowTable(cube: CubeValue): { columns: CubeRowColumn[] } {
  const rows = cube.columns.reduce((m, c) => Math.max(m, c.cells.length), 0);
  return {
    columns: cube.columns.map((col): CubeRowColumn => {
      const u = cellsUnit(col);
      const tables = col.cells.some(isTableCell);
      if (!tables && !col.cells.some(Array.isArray)) return scalarRead(col, rows, u);
      // A table cell refuses on its own row only; the column's other rows still read ([[C22]] rowFormulaRefs).
      const tableErr = solError("#SHAPE!", `This row of "${col.name}" holds a table; a formula reads values and lists`);
      const magnitude = u && !isSolError(u) && u.base ? itemBase : itemMagnitude;
      const values = Array.from({ length: rows }, (_, i) => {
        const c = col.cells[i] ?? null;
        return isTableCell(c) ? tableErr : magnitude(c);
      });
      const items = values.flatMap((v) => (v === tableErr ? [] : Array.isArray(v) ? v.flat() : [v]));
      return withUnit({
        name: col.name,
        type: col.type ?? inferColumn(col.name, items).type,
        values,
        whole: tables
          ? solError("#SHAPE!", `"${col.name}" holds a table in some row, so it has no single table to read. Use ${atRef(col.name)} to read this row's.`)
          : stackedRows(col, values),
      }, u);
    }),
  };
}

/** The element type of a Cube computed column: a list column takes its items' type. */
export function cubeCellsType(cells: readonly CubeCell[]): FrameColType | null {
  if (!cells.some(Array.isArray)) return null;
  return inferColumn("", cells.flatMap((c) => (Array.isArray(c) ? (c as unknown[]).flat() : [c]))).type;
}
