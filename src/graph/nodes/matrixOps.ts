import { solError, type SolError } from "../errorValue";

// ─── Pure matrix kernels — ONE implementation per op, two surfaces (FX-1) ─────
// The matrix nodes' `data()` and the D23 matrix-formula registrations both call
// these, so MMULT in a formula and an MMULT node cannot disagree
// (`formulaMatrix.test.ts` pins the equality). RETE-FREE per FX-2 — the formula
// path must not load the editor; nodes/matrix.ts imports these and keeps only
// the socket/unit plumbing.
//
// Cells are element-agnostic where the op is a pure reshape (transpose, wrap) and
// numerically guarded where it is linear algebra (asNumericMatrix). Error CODES
// here are the node family's, verbatim — #TYPE! wrong element family, #VALUE!
// incomplete data, #SHAPE! wrong dimensions, #DIV/0! singular.

export type NumMat = number[][];

export function matRows(m: readonly unknown[][]): number { return m.length; }
export function matCols(m: readonly unknown[][]): number { return m[0]?.length ?? 0; }

export function matTranspose<T>(m: T[][]): T[][] {
  const rows = matRows(m), cols = matCols(m);
  return Array.from({ length: cols }, (_, j) =>
    Array.from({ length: rows }, (_, i) => m[i][j]));
}

export function matUnit(n: number, offDiag: number | null = 0): (number | null)[][] {
  const k = Math.round(n);
  if (k < 1) return [];
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 1 : offDiag)));
}

/** The numeric gate for linear algebra: a missing cell is #VALUE! (complete data
 *  needed), a non-number is #TYPE! (wrong element family — matrices are
 *  homogeneous, but an anytable can deliver text). */
export function asNumericMatrix(m: unknown[][]): NumMat | SolError {
  for (const row of m)
    for (const cell of row) {
      if (cell === null || cell === undefined || cell === "")
        return solError("#VALUE!", "This matrix operation needs complete data; a cell is missing");
      if (typeof cell !== "number" || !Number.isFinite(cell))
        return solError("#TYPE!", "This matrix operation needs numbers, but got text");
    }
  return m as NumMat;
}

export function matMul(a: NumMat, b: NumMat): NumMat | null {
  const m = matRows(a), n = matCols(a), p = matCols(b);
  if (n !== matRows(b) || n === 0) return null;
  const r: NumMat = Array.from({ length: m }, () => Array(p).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++)
      for (let k = 0; k < n; k++)
        r[i][j] += a[i][k] * b[k][j];
  return r;
}

// LU decomposition with partial pivoting for det and inverse.
function matLU(m: NumMat): { U: NumMat; sign: number } | null {
  const n = matRows(m);
  if (n !== matCols(m)) return null;
  const a = m.map((row) => [...row]);
  let sign = 1;
  for (let i = 0; i < n; i++) {
    let maxVal = Math.abs(a[i][i]), maxR = i;
    for (let r = i + 1; r < n; r++)
      if (Math.abs(a[r][i]) > maxVal) { maxVal = Math.abs(a[r][i]); maxR = r; }
    if (maxVal < 1e-14) return null;
    if (maxR !== i) { [a[i], a[maxR]] = [a[maxR], a[i]]; sign *= -1; }
    for (let r = i + 1; r < n; r++) {
      a[r][i] /= a[i][i];
      for (let c = i + 1; c < n; c++) a[r][c] -= a[r][i] * a[i][c];
    }
  }
  const U: NumMat = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (j >= i ? a[i][j] : 0)));
  return { U, sign };
}

export function matDet(m: NumMat): number | null {
  const lu = matLU(m);
  if (!lu) return null;
  let d = lu.sign;
  for (let i = 0; i < lu.U.length; i++) d *= lu.U[i][i];
  return d;
}

export function matInverse(m: NumMat): NumMat | null {
  const n = matRows(m);
  if (n !== matCols(m)) return null;
  const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let max = Math.abs(aug[i][i]), maxR = i;
    for (let r = i + 1; r < n; r++)
      if (Math.abs(aug[r][i]) > max) { max = Math.abs(aug[r][i]); maxR = r; }
    if (max < 1e-14) return null;
    if (maxR !== i) [aug[i], aug[maxR]] = [aug[maxR], aug[i]];
    const pivot = aug[i][i];
    for (let c = 0; c < 2 * n; c++) aug[i][c] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = aug[r][i];
      for (let c = 0; c < 2 * n; c++) aug[r][c] -= f * aug[i][c];
    }
  }
  return aug.map((row) => row.slice(n));
}

/** WRAPROWS / WRAPCOLS: wrap a 1-D list into a matrix, padding the leftover cells
 *  via `pad()` — D15's rule: shape CONSTRUCTION pads #N/A, Excel's default
 *  pad_with (the caller supplies it, so a pad_with argument overrides cleanly). */
export function wrapCells<T>(list: readonly T[], w: number, dir: "rows" | "cols", pad: () => T): T[][] {
  if (dir === "rows") {
    const rows: T[][] = [];
    for (let i = 0; i < list.length; i += w) {
      const row = list.slice(i, i + w);
      while (row.length < w) row.push(pad());
      rows.push(row as T[]);
    }
    return rows;
  }
  const nCols = Math.ceil(list.length / w);
  const mat: T[][] = Array.from({ length: w }, () => Array.from({ length: nCols }, pad));
  for (let i = 0; i < list.length; i++) mat[i % w][Math.floor(i / w)] = list[i] as T;
  return mat;
}
