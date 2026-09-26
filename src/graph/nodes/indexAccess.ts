// [[C17]]
// Frame and cube slicing stay in the node: frame.ts imports the socket lattice, and `tagFrameCellUnit` arrives as an argument
// because unitColumn.ts reaches rete through unitBridge.

import { solError, type SolError } from "../errorValue";
import { matrixUnitOf, type ColumnUnit } from "../unitValue";

export type IndexAxis = number | null | undefined;

export type UnitTagger = (v: unknown, cu: ColumnUnit) => unknown;

export type Axes =
  | { blank: true }
  | { blank: false; rowAll: boolean; colAll: boolean; r: number; c: number };

export function resolveAxes(row: IndexAxis, col: IndexAxis): Axes {
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
  const ax = resolveAxes(row, col);
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

  // One index walks the list; with two, it reads along whichever axis names a position past 1 ([[D84]] listEitherAxis).
  const arr = v as unknown[];
  const item = (i: number, what: string) => (i < 0 || i >= arr.length ? indexRefError(i + 1, arr.length, what) : arr[i] as unknown);
  if (col === undefined) return rowAll ? [...arr] : item(r, "Item");
  if (!rowAll && r !== 0) {
    if (!colAll && c !== 0) return indexRefError(c + 1, 1, "Column");
    return item(r, "Row");
  }
  return colAll ? [...arr] : item(c, "Column");
}
