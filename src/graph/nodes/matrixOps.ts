import { solError, type SolError } from "../errorValue";
import { indexRefError } from "./indexAccess";
import type { Cell } from "./coerce";

// ONE implementation per matrix op, called by both the nodes' `data()` and the formula
// registrations (shareImpl); RETE-FREE per implReteFree, so the formula path never loads the editor.

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

/** numpy.diag: a length-n list becomes the diagonal of an n×n matrix; the off-diagonal
 *  is `offDiag` (0 like MUNIT, or null = blank so it stays out of sums). A null in the
 *  list is a blank diagonal cell. */
export function matDiag(values: ReadonlyArray<number | null>, offDiag: number | null = 0): (number | null)[][] {
  const n = values.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? values[i] : offDiag)));
}

/** numpy.outer: rows × cols matrix of products a[i]·b[j]. A null in either operand
 *  makes its whole row/column blank. */
export function outerProduct(a: ReadonlyArray<number | null>, b: ReadonlyArray<number | null>): (number | null)[][] {
  return a.map((ai) => b.map((bj) => (ai == null || bj == null ? null : ai * bj)));
}

/** The numeric gate for linear algebra: a missing cell is #VALUE! (complete data needed),
 *  a non-number is #TYPE! (an anytable can deliver text into a homogeneous matrix). */
export function asNumericMatrix(m: unknown[][]): NumMat | SolError {
  for (const row of m)
    for (const cell of row) {
      if (cell === null || cell === undefined || cell === "")
        return solError("#VALUE!", "This matrix operation needs complete data. A cell is missing");
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

/** Wrap a 1-D list into a matrix; leftover cells take the caller's `pad()`, which defaults
 *  to #N/A per appendLadder so a pad_with argument overrides cleanly. */
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

// ── The append-ladder + selection + grow shape ops (appendLadder). Shape CONSTRUCTION pads
// #N/A (the exception is EXPAND's Fill, below). The nodes add unit tagging on top;
// these are pure shape, so both surfaces share them (shareImpl). ──

/** HSTACK: glue matrices left-to-right, padding shorter ones DOWN with #N/A. */
export function stackH(mats: readonly unknown[][][]): unknown[][] {
  const height = Math.max(...mats.map(matRows));
  const na = solError("#N/A", "Padded: this input is shorter than the largest one");
  const out: unknown[][] = Array.from({ length: height }, () => []);
  for (const m of mats) {
    const w = matCols(m);
    for (let i = 0; i < height; i++) out[i].push(...(i < m.length ? m[i] : Array<unknown>(w).fill(na)));
  }
  return out;
}

/** VSTACK: stack matrices top-to-bottom, padding narrower ones RIGHT with #N/A. A bare
 *  list is one ROW upstream, so stacking two lists yields a 2×n grid. */
export function stackV(mats: readonly unknown[][][]): unknown[][] {
  const width = Math.max(...mats.map(matCols));
  const na = solError("#N/A", "Padded: this input is narrower than the largest one");
  const out: unknown[][] = [];
  for (const m of mats)
    for (const r of m) out.push(r.length < width ? [...r, ...Array<unknown>(width - r.length).fill(na)] : [...r]);
  return out;
}

/** CHOOSEROWS / CHOOSECOLS: select rows/columns by 1-based index (negative counts from
 *  the end, fractional truncates toward zero); any zero/out-of-range index errors the
 *  whole call (#VALUE!). Element-preserving. */
export function chooseAxis<T>(m: T[][], indices: readonly number[], kind: "row" | "column"): T[][] | SolError {
  const size = kind === "row" ? matRows(m) : matCols(m);
  const label = kind === "row" ? "CHOOSEROWS" : "CHOOSECOLS";
  const resolved: number[] = [];
  for (const i of indices) {
    const p = i < 0 ? size + Math.trunc(i) : Math.trunc(i) - 1;
    if (!(p >= 0 && p < size))
      return solError("#VALUE!", `${label}: ${kind} index ${i} is out of range for a table with ${size} ${kind}s`);
    resolved.push(p);
  }
  return kind === "row" ? resolved.map((r) => [...m[r]]) : m.map((row) => resolved.map((c) => row[c]));
}

/** EXPAND: grow a matrix to R×C, filling new cells with `fill`. Shrinking is #VALUE!;
 *  a 0 (Excel's omitted) target keeps that axis. Unlike WRAP, the omitted-Fill default
 *  is the caller's choice — the node/formula pass first-class `null`, the author's
 *  override of Excel's #N/A (value-semantics.md). */
export function expandMat<T>(m: T[][], reqR: number, reqC: number, fill: T): T[][] | SolError {
  const curR = matRows(m), curC = matCols(m);
  const R = reqR > 0 ? reqR : curR;
  const C = reqC > 0 ? reqC : curC;
  if (R < curR || C < curC)
    return solError("#VALUE!", `EXPAND can only grow: the table is ${curR}×${curC}, the target ${R}×${C}. Use TAKE to shrink`);
  const out: T[][] = [];
  for (let i = 0; i < R; i++) {
    const src = i < curR ? m[i] : [];
    const row: T[] = [];
    for (let j = 0; j < C; j++) row.push(j < src.length ? src[j] : fill);
    out.push(row);
  }
  return out;
}

/** SET CELL: overwrite cells of a 2-D table by 1-based address. The input is normalized
 *  to a full rows×cols grid first (ragged rows pad with blank, like EXPAND), then writes
 *  apply in ROW ORDER so a later row wins on a repeated address. Any address outside the
 *  table errors the WHOLE result (`#REF!`, the shared indexRefError wording — matching
 *  Table Select's out-of-range rule). */
export function setCells(
  m: Cell[][],
  writes: ReadonlyArray<{ r: number; c: number; v: Cell }>,
): Cell[][] | SolError {
  const rows = matRows(m), cols = matCols(m);
  const out: Cell[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (j < (m[i]?.length ?? 0) ? m[i][j] : null)));
  for (const w of writes) {
    const r = Math.round(w.r), c = Math.round(w.c);
    if (r < 1 || r > rows) return indexRefError(r, rows, "Row");
    if (c < 1 || c > cols) return indexRefError(c, cols, "Column");
    out[r - 1][c - 1] = w.v;
  }
  return out;
}

/** Sum of the main diagonal (numpy trace). */
export function matTrace(m: NumMat): number {
  const n = Math.min(matRows(m), matCols(m));
  let t = 0;
  for (let i = 0; i < n; i++) t += m[i][i];
  return t;
}

/** Rank by Gaussian elimination with partial pivoting and a relative tolerance
 *  (numpy.linalg.matrix_rank's spirit: tiny pivots count as zero). */
export function matRank(m: NumMat, tol = 1e-10): number {
  const rows = matRows(m), cols = matCols(m);
  const a = m.map((r) => [...r]);
  const scale = Math.max(1e-300, ...a.flat().map(Math.abs));
  let rank = 0;
  for (let c = 0; c < cols && rank < rows; c++) {
    let piv = rank;
    for (let r = rank + 1; r < rows; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) <= tol * scale) continue;
    [a[rank], a[piv]] = [a[piv], a[rank]];
    for (let r = rank + 1; r < rows; r++) {
      const f = a[r][c] / a[rank][c];
      for (let k = c; k < cols; k++) a[r][k] -= f * a[rank][k];
    }
    rank++;
  }
  return rank;
}

export type MatNormKind = "fro" | "1" | "inf" | "max";
/** Matrix norms: Frobenius (numpy default), 1-norm (max column sum), ∞-norm (max row
 *  sum), max absolute entry. */
export function matNorm(m: NumMat, kind: MatNormKind = "fro"): number {
  if (kind === "fro") return Math.sqrt(m.reduce((a, r) => a + r.reduce((x, y) => x + y * y, 0), 0));
  if (kind === "max") return Math.max(0, ...m.flat().map(Math.abs));
  if (kind === "1") { let best = 0; for (let c = 0; c < matCols(m); c++) best = Math.max(best, m.reduce((a, r) => a + Math.abs(r[c]), 0)); return best; }
  return Math.max(0, ...m.map((r) => r.reduce((a, v) => a + Math.abs(v), 0)));
}

/** Solve A·x = b by Gaussian elimination with partial pivoting (numpy.linalg.solve, R
 *  solve). `null` when A is singular (or not square / b mismatched). */
export function matSolve(A: NumMat, b: readonly number[]): number[] | null {
  const n = matRows(A);
  if (n === 0 || matCols(A) !== n || b.length !== n) return null;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Eigen-decomposition of a SYMMETRIC matrix by cyclic Jacobi rotations (numpy.linalg.eigh,
 *  R eigen(symmetric=TRUE)): eigenvalues descending, eigenvectors as the COLUMNS of `vectors`
 *  in the same order (unit length). `null` when not square or not symmetric. */
export function matEigh(m: NumMat, tol = 1e-12): { values: number[]; vectors: NumMat } | null {
  const n = matRows(m);
  if (n === 0 || matCols(m) !== n) return null;
  const scale = Math.max(1e-300, ...m.flat().map(Math.abs));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(m[i][j] - m[j][i]) > 1e-9 * scale) return null;
  const a = m.map((r) => [...r]);
  const v: NumMat = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < tol * tol * scale * scale) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  const values = order.map((i) => a[i][i]);
  const vectors: NumMat = Array.from({ length: n }, (_, r) => order.map((i) => v[r][i]));
  // Deterministic sign: the largest-magnitude component of each eigenvector is positive.
  for (let c = 0; c < n; c++) {
    let big = 0;
    for (let r = 1; r < n; r++) if (Math.abs(vectors[r][c]) > Math.abs(vectors[big][c])) big = r;
    if (vectors[big][c] < 0) for (let r = 0; r < n; r++) vectors[r][c] = -vectors[r][c];
  }
  return { values, vectors };
}
