// [[C17]]
// Frame and cube slicing stay in the node: frame.ts imports the socket lattice, and `tagFrameCellUnit` arrives as an argument
// because unitColumn.ts reaches rete through unitBridge.

import { isSolError, solError, type SolError } from "../errorValue";
import { matrixUnitOf, type ColumnUnit } from "../unitValue";

/** A position, or several: Excel's INDEX answers once per position in an array ([[D85]] columnsStayColumns). */
export type IndexAxis = IndexPosition | unknown[];

export type IndexPosition = number | null | undefined;

export type UnitTagger = (v: unknown, cu: ColumnUnit) => unknown;

export type Axes =
  | { blank: true }
  | { blank: false; rowAll: boolean; colAll: boolean; r: number; c: number };

export function resolveAxes(row: IndexPosition, col: IndexPosition): Axes {
  if (row === null || col === null) return { blank: true };
  const rowAll = row === undefined || Math.trunc(row) === 0;
  const colAll = col === undefined || Math.trunc(col) === 0;
  return {
    blank: false, rowAll, colAll,
    r: rowAll ? -1 : Math.trunc(row) - 1,
    c: colAll ? -1 : Math.trunc(col) - 1,
  };
}

export function indexRefError(n: number, max: number, what: string): SolError {
  return solError("#REF!", `${what} ${n} is outside 1…${max}`);
}

export function indexInto(v: unknown, row: IndexAxis, col: IndexAxis, tagUnit?: UnitTagger): unknown {
  if (v === null || v === undefined) return null;
  row = skipBlankPositions(row);
  col = skipBlankPositions(col);
  if (Array.isArray(row) || Array.isArray(col)) return indexMany(v, row, col, tagUnit);
  const ax = resolveAxes(row as IndexPosition, col as IndexPosition);
  if (ax.blank) return null;
  const { rowAll, colAll, r, c } = ax;

  if (!Array.isArray(v)) {
    const ok = (rowAll || r === 0) && (colAll || c === 0);
    return ok ? v : solError("#REF!", "Index is outside a single value. Only index 1 exists");
  }

  if (Array.isArray((v as unknown[])[0])) {
    const grid = v as unknown[][];
    const mUnit = matrixUnitOf(v);
    const tag = (x: unknown): unknown => (mUnit && tagUnit ? tagUnit(x, mUnit) : x);
    if (rowAll && colAll) return grid;
    // One position on a one-row or one-column table walks along it, as Excel's INDEX does ([[D85]] columnsStayColumns).
    if (col === undefined && !rowAll) {
      const width = grid.reduce<number>((m, row) => Math.max(m, Array.isArray(row) ? row.length : 1), 0);
      if (grid.length === 1 && Array.isArray(grid[0])) {
        const only = grid[0] as unknown[];
        return r < 0 || r >= only.length ? indexRefError(r + 1, only.length, "Column") : tag(only[r] ?? null);
      }
      if (width === 1) {
        if (r < 0 || r >= grid.length) return indexRefError(r + 1, grid.length, "Row");
        const row = grid[r];
        return tag(Array.isArray(row) ? (row[0] ?? null) : row);
      }
    }
    if (!rowAll && (r < 0 || r >= grid.length)) return indexRefError(r + 1, grid.length, "Row");
    if (rowAll) {
      const width = grid.reduce<number>((m, row) => Math.max(m, Array.isArray(row) ? row.length : 1), 0);
      if (c < 0 || c >= width) return indexRefError(c + 1, width, "Column");
      return grid.map((row) => tag(Array.isArray(row) ? (row[c] ?? null) : c === 0 ? row : null));
    }
    const rowArr = Array.isArray(grid[r]) ? grid[r] : [grid[r] as unknown];
    if (colAll) return rowArr.map(tag);
    if (c < 0 || c >= rowArr.length) return indexRefError(c + 1, rowArr.length, "Column");
    return tag(rowArr[c] ?? null);
  }

  // A list is one row ([[D85]] columnsStayColumns): one index walks along it, as Excel's INDEX does on a one-row
  // range; with two, the row must be 1 and the column picks the item.
  const arr = v as unknown[];
  const item = (i: number, what: string) => (i < 0 || i >= arr.length ? indexRefError(i + 1, arr.length, what) : arr[i] as unknown);
  if (col === undefined) return rowAll ? [...arr] : item(r, "Item");
  if (!rowAll && r !== 0) return indexRefError(r + 1, 1, "Row");
  return colAll ? [...arr] : item(c, "Column");
}

const isGrid = (x: unknown): x is unknown[][] => Array.isArray(x) && x.length > 0 && Array.isArray(x[0]);
const asGrid = (x: unknown): unknown[][] => (isGrid(x) ? x : Array.isArray(x) ? [x] : [[x]]);
const wholeAxis = (x: IndexAxis): boolean => x === undefined || (typeof x === "number" && Math.trunc(x) === 0);

function positionOf(x: unknown): number | null | SolError {
  if (x === null || x === undefined || isSolError(x)) return (x ?? null) as null | SolError;
  const n = typeof x === "number" ? x : typeof x === "boolean" ? Number(x) : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isNaN(n) ? solError("#VALUE!", "INDEX position must be a number") : n;
}

/**
 * Several positions. On a table whose other axis is whole, a list of rows or columns picks those rows or columns, as
 * CHOOSEROWS and CHOOSECOLS do. Otherwise the two axes pair up as Excel's array arguments do (a list against a column
 * spreads into a table, a size mismatch pads with #N/A), one value per pair; a pair that would answer a whole row is #VALUE!.
 */
/** A blank in a list of positions is skipped; a list with none left is the axis left out, the whole axis ([[E15]]). */
function skipBlankPositions(a: IndexAxis): IndexAxis {
  if (!Array.isArray(a) || isGrid(a)) return a;
  const kept = a.filter((p) => p != null);
  return kept.length ? kept : undefined;
}

function indexMany(v: unknown, row: IndexAxis, col: IndexAxis, tagUnit?: UnitTagger): unknown {
  if (isGrid(v) && (Array.isArray(row) !== Array.isArray(col))) {
    const picks = Array.isArray(row) ? row : (col as unknown[]);
    const other = Array.isArray(row) ? col : row;
    const walks = col === undefined && (v.length === 1 || v.every((r) => !Array.isArray(r) || r.length <= 1));
    if (!walks && wholeAxis(other) && !isGrid(picks)) {
      const slices = picks.map((p) => {
        const at = positionOf(p);
        if (at === null || isSolError(at)) return at;
        return Array.isArray(row) ? indexInto(v, at, other as number | undefined, tagUnit) : indexInto(v, other as number | undefined, at, tagUnit);
      });
      const bad = slices.find((x) => x === null || isSolError(x) || !Array.isArray(x));
      if (bad !== undefined) return bad;
      const lists = slices as unknown[][];
      return Array.isArray(row) ? lists : lists[0].map((_, i) => lists.map((c) => c[i] ?? null));
    }
  }
  const rg = row === undefined ? undefined : asGrid(row);
  const cg = col === undefined ? undefined : asGrid(col);
  const h = Math.max(rg?.length ?? 1, cg?.length ?? 1);
  const w = Math.max(rg?.[0]?.length ?? 1, cg?.[0]?.length ?? 1);
  const at = (g: unknown[][] | undefined, i: number, j: number): number | null | undefined | SolError => {
    if (!g) return undefined;
    const gi = g.length === 1 ? 0 : i, gj = g[0].length === 1 ? 0 : j;
    if (gi >= g.length || gj >= g[gi].length) return solError("#N/A", "The positions are different sizes");
    return positionOf(g[gi][gj]);
  };
  const out = Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => {
    const r = at(rg, i, j), c = at(cg, i, j);
    if (isSolError(r)) return r;
    if (isSolError(c)) return c;
    const x = indexInto(v, r, c, tagUnit);
    return Array.isArray(x) ? solError("#VALUE!", "Each pair of positions must pick one value") : x;
  }));
  return h === 1 ? out[0] : out;
}
