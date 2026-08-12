// The INDEX accessor, shared by the INDEX node (nodes/list.ts) and the INDEX
// formula (excelFunctions.ts) so the two surfaces cannot answer differently.
// Pure — no React/Rete.
//
// SCOPE: scalar / list / matrix — everything both surfaces can hold. Frame and
// cube slicing stays in the node (FX-9: neither reaches a formula), because
// `frame.ts` imports the socket lattice and the formula path must not load it
// (FX-2, formulaPathIsReteFree.test.ts). Same reason `tagFrameCellUnit` arrives
// as an argument instead of an import — `unitColumn.ts` reaches rete through
// unitBridge.

import { solError, type SolError } from "../errorValue";
import { matrixUnitOf, type ColumnUnit } from "../unitValue";

/** An axis argument: a 1-based position, `undefined` for an axis that was never
 *  given (the WHOLE axis, like Excel's omitted `row_num`), or `null` for one given
 *  as blank (unknown → so is the result). */
export type IndexAxis = number | null | undefined;

/** Applies a column/matrix unit to an extracted cell (`tagFrameCellUnit`); omitted
 *  on the unit-blind formula surface, where a stripped matrix has none to carry. */
export type UnitTagger = (v: unknown, cu: ColumnUnit) => unknown;

export type Axes =
  | { blank: true }
  | { blank: false; rowAll: boolean; colAll: boolean; r: number; c: number };

/** Excel INDEX: 0 (or omitted) selects the WHOLE axis; a blank axis is unknown.
 *  `r`/`c` are 0-based, and −1 when that axis is whole. */
export function resolveAxes(row: IndexAxis, col: IndexAxis): Axes {
  if (row === null || col === null) return { blank: true };
  const rowAll = row === undefined || Math.round(row) === 0;
  const colAll = col === undefined || Math.round(col) === 0;
  return {
    blank: false, rowAll, colAll,
    r: rowAll ? -1 : Math.round(row) - 1,
    c: colAll ? -1 : Math.round(col) - 1,
  };
}

/** The out-of-range error, shared so both surfaces word it identically. */
export function indexRefError(n: number, max: number, what: string): SolError {
  return solError("#REF!", `${what} ${n} is outside 1…${max}`);
}

/**
 * Read out of a scalar, a 1-D list, or a 2-D matrix. `row`/`col` are 1-based; 0 or
 * undefined selects the WHOLE axis (Excel's `INDEX(range, 0, col)`), and both whole
 * passes the container through. Matrix slices come out as 1-D lists.
 */
export function indexInto(v: unknown, row: IndexAxis, col: IndexAxis, tagUnit?: UnitTagger): unknown {
  if (v === null || v === undefined) return null;
  const ax = resolveAxes(row, col);
  if (ax.blank) return null;
  const { rowAll, colAll, r, c } = ax;

  if (!Array.isArray(v)) {
    // A scalar is a 1×1 — row/col 1 (or [all]) returns it, anything else #REF!.
    const ok = (rowAll || r === 0) && (colAll || c === 0);
    return ok ? v : solError("#REF!", "Index is outside a single value; only index 1 exists");
  }

  if (Array.isArray((v as unknown[])[0])) {
    // A genuine 2-D matrix.
    const grid = v as unknown[][];
    // A homogeneous matrix unit (D20) must ride out into the extraction, so each
    // extracted number is tagged; `tag` is identity for a plain matrix.
    const mUnit = matrixUnitOf(v);
    const tag = (x: unknown): unknown => (mUnit && tagUnit ? tagUnit(x, mUnit) : x);
    if (rowAll && colAll) return grid;
    if (!rowAll && (r < 0 || r >= grid.length)) return indexRefError(r + 1, grid.length, "Row");
    if (rowAll) {
      // Whole column as a 1-D list (a ragged short row contributes null).
      const width = grid.reduce<number>((m, row) => Math.max(m, Array.isArray(row) ? row.length : 1), 0);
      if (c < 0 || c >= width) return indexRefError(c + 1, width, "Column");
      return grid.map((row) => tag(Array.isArray(row) ? (row[c] ?? null) : c === 0 ? row : null));
    }
    const rowArr = Array.isArray(grid[r]) ? grid[r] : [grid[r] as unknown];
    if (colAll) return rowArr.map(tag); // whole row as a 1-D list
    if (c < 0 || c >= rowArr.length) return indexRefError(c + 1, rowArr.length, "Column");
    return tag(rowArr[c] ?? null);
  }

  // is2D treats a flat list as an n×1 column, so Column (when given) must be 1.
  const arr = v as unknown[];
  if (!colAll && c !== 0) return indexRefError(c + 1, 1, "Column");
  if (rowAll) return [...arr]; // whole column = the list itself
  if (r < 0 || r >= arr.length) return indexRefError(r + 1, arr.length, "list");
  return arr[r] as unknown;
}
