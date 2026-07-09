import { ClassicPreset } from "rete";
import { numIn, numOut, listIn, anyIn, anyOut, anyTableIn, anyTableOut, tableIn, tableOut, frameIn } from "./shared";
import { toAnyMatrix, type Cell } from "./coerce";
import { parseCsvRows } from "../csv";
import { solError, isSolError, type SolError } from "../errorValue";
import { isFrameValue, frameRowCount } from "../frame";

// ─── Internal helpers ─────────────────────────────────────────────────────────

type Mat = (number | null)[][];  // numeric matrix; a null cell is MISSING (linear-algebra ops reject it)
type NumMat = number[][];        // a COMPLETE numeric matrix — the compute kernels run only after asNumericMatrix
type CellMat = Cell[][];          // element-agnostic matrix (the pure-reshape ops)

// Dimensions / transpose are element-agnostic — used by both the numeric ops and
// the polymorphic reshapers (TRANSPOSE / TOROW / …), so they take any matrix.
function matRows(m: readonly unknown[][]): number { return m.length; }
function matCols(m: readonly unknown[][]): number { return m[0]?.length ?? 0; }

// The strictly-numeric matrix ops (MMULT / MDETERM / MINVERSE) declare a numeric
// `table` input, but an `anytable` (the 2-D wildcard) can still land on them: the
// socket only blocks DROPPING a dimension, not narrowing the element type, so a
// text/date matrix reaches here and would otherwise multiply strings into NaN
// soup (see docs/backlog.md "Ameliorate the anytable element-type risk"). Guard
// at runtime with a tagged #TYPE! instead — the element-type error code, distinct
// from #VALUE! (operand misuse): the value is wired correctly, it's just the wrong
// element family for a numeric op. Element types are HOMOGENEOUS within a matrix —
// the type system never mixes them — so the first non-blank cell classifies the
// whole grid; no full scan needed. The positive test (finite number) also rejects
// the degenerate object/NaN cases, not just text.
function asNumericMatrix(m: CellMat): NumMat | SolError {
  // Full scan (not first-cell): a numeric matrix may now have `null` GAPS, and
  // linear algebra can't run with a missing cell — reject it as #VALUE! (complete
  // data needed), distinct from #TYPE! (wrong element family — text in a number op).
  for (const row of m)
    for (const cell of row) {
      if (cell === null || cell === undefined || cell === "")
        return solError("#VALUE!", "This matrix operation needs complete data; a cell is missing");
      if (typeof cell !== "number" || !Number.isFinite(cell))
        return solError("#TYPE!", "This matrix operation needs numbers, but got text");
    }
  return m as NumMat; // every cell is a finite number
}

function matMul(a: NumMat, b: NumMat): NumMat | null {
  const m = matRows(a), n = matCols(a), p = matCols(b);
  if (n !== matRows(b) || n === 0) return null;
  const r: NumMat = Array.from({ length: m }, () => Array(p).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++)
      for (let k = 0; k < n; k++)
        r[i][j] += a[i][k] * b[k][j];
  return r;
}

function matTranspose<T>(m: T[][]): T[][] {
  const rows = matRows(m), cols = matCols(m);
  return Array.from({ length: cols }, (_, j) =>
    Array.from({ length: rows }, (_, i) => m[i][j]));
}

function matUnit(n: number): NumMat {
  const k = Math.round(n);
  if (k < 1) return [];
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
}

// LU decomposition with partial pivoting for det and inverse.
function matLU(m: NumMat): { L: NumMat; U: NumMat; P: number[]; sign: number } | null {
  const n = matRows(m);
  if (n !== matCols(m)) return null;
  const a = m.map(row => [...row]);
  const P = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  for (let i = 0; i < n; i++) {
    let maxVal = Math.abs(a[i][i]), maxR = i;
    for (let r = i + 1; r < n; r++)
      if (Math.abs(a[r][i]) > maxVal) { maxVal = Math.abs(a[r][i]); maxR = r; }
    if (maxVal < 1e-14) return null;
    if (maxR !== i) { [a[i], a[maxR]] = [a[maxR], a[i]]; [P[i], P[maxR]] = [P[maxR], P[i]]; sign *= -1; }
    for (let r = i + 1; r < n; r++) {
      a[r][i] /= a[i][i];
      for (let c = i + 1; c < n; c++) a[r][c] -= a[r][i] * a[i][c];
    }
  }
  const L: NumMat = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => j < i ? a[i][j] : j === i ? 1 : 0));
  const U: NumMat = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => j >= i ? a[i][j] : 0));
  return { L, U, P, sign };
}

function matDet(m: NumMat): number | null {
  const lu = matLU(m);
  if (!lu) return null;
  let d = lu.sign;
  for (let i = 0; i < lu.U.length; i++) d *= lu.U[i][i];
  return d;
}

function matInverse(m: NumMat): NumMat | null {
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
  return aug.map(row => row.slice(n));
}

export function parseTableText(text: string): Mat | null {
  const raw = parseCsvRows(text);
  if (raw.length === 0) return null;
  const cols = raw[0].length;
  const rows: (number | null)[][] = [];
  for (const r of raw) {
    if (r.length !== cols) return null; // ragged → reject the whole table
    const cells: (number | null)[] = [];
    for (const v of r) {
      const t = v.trim();
      if (t === "") { cells.push(null); continue; } // a blank cell is MISSING → null
      const n = Number(t);
      if (Number.isNaN(n)) return null; // a non-blank, non-numeric cell → not a numeric table
      cells.push(n);
    }
    rows.push(cells);
  }
  return rows;
}

// Serialize a matrix back to the Table Input text form (one row per line, values
// comma-separated) — the inverse of parseTableText, used when the grid editor
// saves edits back to the node.
export function tableToText(m: Mat): string {
  return m.map(row => row.join(", ")).join("\n");
}

// ─── TABLE INPUT ──────────────────────────────────────────────────────────────

export class TableInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Mat | null = null;
  tableText: string = "1, 0\n0, 1";
  width = 220; height = 220;

  constructor(init?: { label?: string; tableText?: string }) {
    super("TableInput");
    this.label = init?.label ?? "Table Input";
    if (init?.tableText != null) this.tableText = init.tableText;
    this.addOutput("table", tableOut("Table"));
    // Dimensions are available from the ROWS / COLUMNS node, so no redundant
    // number outputs here — just the table.
  }

  data() {
    const m = parseTableText(this.tableText);
    this.cachedResult = m;
    return { table: m };
  }
}

// ─── MDETERM / MINVERSE ───────────────────────────────────────────────────────

export type MatDetOp = "mdeterm" | "minverse";

export const MAT_DET_OP_META = {
  mdeterm:  { label: "MDETERM",  description: "Determinant of a square matrix. Excel: MDETERM." },
  minverse: { label: "MINVERSE", description: "Inverse of a square matrix: result × input = identity. Excel: MINVERSE." },
} satisfies Record<MatDetOp, { label: string; description: string }>;

export class MatDetNode extends ClassicPreset.Node {
  label: string;
  op: MatDetOp;
  cachedScalar: number | SolError | null = null;
  cachedMatrix: Mat | SolError | null = null;
  width = 180; height = 195;

  constructor(init?: { label?: string; op?: MatDetOp }) {
    super("MatDet");
    this.op    = init?.op    ?? "mdeterm";
    this.label = init?.label ?? MAT_DET_OP_META[this.op].label;
    this.addInput("matrix", tableIn("Matrix"));
    if (this.op === "mdeterm") {
      this.addOutput("result", numOut("Determinant"));
    } else {
      this.addOutput("result", tableOut("Inverse"));
    }
  }

  data(inputs: { matrix?: CellMat[] }): { result: number | Mat | SolError | null } {
    const raw = inputs.matrix?.[0] ?? null;
    this.cachedScalar = null;
    this.cachedMatrix = null;
    if (!raw) return { result: null };
    // An anytable could carry text — reject non-numeric matrices up front.
    const m = asNumericMatrix(raw);
    if (isSolError(m)) {
      if (this.op === "mdeterm") this.cachedScalar = m; else this.cachedMatrix = m;
      return { result: m };
    }
    // A non-square matrix has no determinant or inverse — a dimension problem
    // (#SHAPE!). A square matrix that the solver rejects is singular (#DIV/0!).
    if (matRows(m) !== matCols(m)) {
      const err = solError("#SHAPE!", "Matrix must be square");
      if (this.op === "mdeterm") this.cachedScalar = err; else this.cachedMatrix = err;
      return { result: err };
    }
    if (this.op === "mdeterm") {
      const d = matDet(m);
      if (d === null) {
        const err = solError("#DIV/0!", "Matrix is singular");
        this.cachedScalar = err;
        return { result: err };
      }
      this.cachedScalar = d;
      return { result: d };
    } else {
      const inv = matInverse(m);
      if (inv === null) {
        const err = solError("#DIV/0!", "Matrix is singular; it has no inverse");
        this.cachedMatrix = err;
        return { result: err };
      }
      this.cachedMatrix = inv;
      return { result: inv };
    }
  }
}

// ─── MMULT ────────────────────────────────────────────────────────────────────

export class TableMultNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Mat | SolError | null = null;
  width = 180; height = 210;

  constructor(init?: { label?: string }) {
    super("TableMult");
    this.label = init?.label ?? "MMULT";
    this.addInput("a", tableIn("A (m×n)"));
    this.addInput("b", tableIn("B (n×p)"));
    this.addOutput("result", tableOut("A × B (m×p)"));
  }

  data(inputs: { a?: CellMat[]; b?: CellMat[] }): { result: Mat | SolError | null } {
    const rawA = inputs.a?.[0] ?? null, rawB = inputs.b?.[0] ?? null;
    if (!rawA || !rawB) { this.cachedResult = null; return { result: null }; }
    // An anytable could carry text — reject non-numeric operands up front.
    const a = asNumericMatrix(rawA), b = asNumericMatrix(rawB);
    if (isSolError(a)) { this.cachedResult = a; return { result: a }; }
    if (isSolError(b)) { this.cachedResult = b; return { result: b }; }
    const product = matMul(a, b);
    // matMul returns null only for non-conformable dimensions — a #SHAPE! error.
    if (product === null) {
      const err = solError("#SHAPE!", "A's column count must equal B's row count");
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = product;
    return { result: product };
  }
}

// ─── MUNIT ────────────────────────────────────────────────────────────────────

export class TableUnitNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Mat | null = null;
  literals: Record<string, number> = { n: 3 };
  width = 180; height = 165;

  constructor(init?: { label?: string }) {
    super("TableUnit");
    this.label = init?.label ?? "MUNIT";
    this.addInput("n", numIn("Size n"));
    this.addOutput("result", tableOut("n×n identity"));
  }

  data(inputs: { n?: number[] }) {
    const n = inputs.n?.[0] ?? this.literals.n ?? 3;
    this.cachedResult = matUnit(n);
    return { result: this.cachedResult };
  }
}

// ─── TRANSPOSE ────────────────────────────────────────────────────────────────

export class TableTransposeNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CellMat | null = null;
  width = 180; height = 180;

  constructor(init?: { label?: string }) {
    super("TableTranspose");
    this.label = init?.label ?? "TRANSPOSE";
    // Element-agnostic reshape: an `any` input accepts any matrix (text/date too),
    // and the output is the 2-D wildcard `anytable` (see sockets.ts).
    this.addInput("matrix", anyTableIn("Matrix"));
    this.addOutput("result", anyTableOut("Transposed"));
  }

  data(inputs: { matrix?: unknown[] }) {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    this.cachedResult = m ? matTranspose(m) : null;
    return { result: this.cachedResult };
  }
}

// ─── HSTACK / VSTACK — the 2-D rungs of the append ladder (decisions.md D15) ──
// N extensible element-agnostic rows (anytable — a scalar widens to 1×1, a list
// to ONE ROW per the lattice rule), stacked in row order. Ragged inputs pad
// with #N/A cells exactly like Excel's VSTACK/HSTACK — a hole is visible and
// recoverable (IFNA/Fill), where the old whole-result #SHAPE! made the common
// "stack a 3-list on a 5-list" case unusable.

/** One #N/A pad cell per data() pass (SolErrors are immutable — sharing is fine).
 *  Typed through Cell: the runtime matrix model carries per-cell SolErrors even
 *  though the pure-reshape Cell alias predates them (array-semantics policy). */
function padCell(what: string): Cell {
  return solError("#N/A", `Padded: this input is ${what} than the largest one`) as unknown as Cell;
}

/** Shared extensible-row plumbing for the two stackers. */
abstract class StackNodeBase extends ClassicPreset.Node {
  label: string;
  cachedResult: CellMat | SolError | null = null;
  nextInputId = 0;
  width = 180; height = 250;

  constructor(name: string, label: string, init?: { label?: string; valueKeys?: string[] }) {
    super(name);
    this.label = init?.label ?? label;
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("t"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("result", anyTableOut("Stacked"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, anyTableIn("Table"));
    const n = parseInt(key.replace(/^t/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Ordered table-row keys (insertion order = stack order). */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("t"));
  }

  addValueInput(): string {
    const key = `t${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
  }

  /** Wired inputs as matrices, in row order; empties (zero-row) drop out. */
  protected matsOf(inputs: Record<string, unknown[] | undefined>): CellMat[] {
    return this.valueInputKeys()
      .map((k) => toAnyMatrix(inputs[k]?.[0]))
      .filter((m): m is CellMat => !!m && m.length > 0);
  }
}

export class HStackTableNode extends StackNodeBase {
  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("HStackTable", "HSTACK", init);
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    const mats = this.matsOf(inputs);
    if (mats.length === 0) { this.cachedResult = null; return { result: null }; }
    // Side-by-side: rows = the tallest input; a shorter input pads down with #N/A.
    const height = Math.max(...mats.map(matRows));
    const na = padCell("shorter");
    const out: CellMat = Array.from({ length: height }, () => []);
    for (const m of mats) {
      const w = matCols(m);
      for (let i = 0; i < height; i++) {
        out[i].push(...(i < m.length ? m[i] : Array<Cell>(w).fill(na)));
      }
    }
    this.cachedResult = out;
    return { result: out };
  }
}

// VSTACK — the top-to-bottom sibling of HSTACK, and the FAST lists→table path:
// a bare list widens to ONE ROW, so stacking two lists yields a 2×n table —
// Excel's VSTACK of two rows. (The node's previous life as a 1-D list
// concatenator moved to Concat Lists in list.ts, 2026-07-09 — stacking and
// appending are different operations.)
export class VStackNode extends StackNodeBase {
  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("VStack", "VSTACK", init);
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    const mats = this.matsOf(inputs);
    if (mats.length === 0) { this.cachedResult = null; return { result: null }; }
    // Top-to-bottom: columns = the widest input; a narrower input pads right with #N/A.
    const width = Math.max(...mats.map(matCols));
    const na = padCell("narrower");
    const out: CellMat = [];
    for (const m of mats) {
      for (const r of m) {
        out.push(r.length < width ? [...r, ...Array<Cell>(width - r.length).fill(na)] : [...r]);
      }
    }
    this.cachedResult = out;
    return { result: out };
  }
}

// ─── WRAPROWS / WRAPCOLS / TOCOL / TOROW ──────────────────────────────────────

export type TableReshapeOp = "wraprows" | "wrapcols" | "tocol" | "torow";

export const TABLE_RESHAPE_OP_META = {
  wraprows: { label: "WRAPROWS", description: "Wrap a list into a table row-by-row; each row has Wrap_count values. Excel: WRAPROWS." },
  wrapcols: { label: "WRAPCOLS", description: "Wrap a list into a table column-by-column; each column has Wrap_count values. Excel: WRAPCOLS." },
  tocol:    { label: "TOCOL",    description: "Flatten a table to a 1D list, reading row by row. Excel: TOCOL." },
  torow:    { label: "TOROW",    description: "Flatten a table to a 1D list, reading column by column. Excel: TOROW." },
} satisfies Record<TableReshapeOp, { label: string; description: string }>;

export class TableReshapeNode extends ClassicPreset.Node {
  label: string;
  op: TableReshapeOp;
  cachedList: Cell[] | null = null;
  cachedMatrix: CellMat | null = null;
  literals: Record<string, number> = { wrapCount: 3 };
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: TableReshapeOp }) {
    super("TableReshape");
    this.op    = init?.op    ?? "wraprows";
    this.label = init?.label ?? TABLE_RESHAPE_OP_META[this.op].label;
    const wraps = this.op === "wraprows" || this.op === "wrapcols";
    // Element-agnostic: `any` inputs accept text/date arrays too. Wrapping
    // produces a matrix (the 2-D wildcard `anytable`); flattening produces a
    // 1-D list of unknown element type (`any`).
    if (wraps) {
      this.addInput("list",      anyIn("List"));
      this.addInput("wrapCount", numIn("Wrap count"));
      this.addOutput("result", anyTableOut("Table"));
    } else {
      this.addInput("matrix", anyTableIn("Matrix"));
      this.addOutput("result", anyOut("List"));
    }
  }

  data(inputs: { list?: unknown[]; wrapCount?: number[]; matrix?: unknown[] }) {
    this.cachedList = null;
    this.cachedMatrix = null;
    // Both wraps pad the leftover cells with #N/A — Excel's default pad_with.
    // (Was inconsistent: wraprows left a ragged short last row, wrapcols
    // filled with NaN, which renders as garbage.)
    if (this.op === "wraprows") {
      const list = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const w = Math.round(inputs.wrapCount?.[0] ?? this.literals.wrapCount ?? 3);
      if (!list || w < 1) return { result: null };
      const na = solError("#N/A", "Padded: the list doesn't fill the last row") as unknown as Cell;
      const rows: CellMat = [];
      for (let i = 0; i < list.length; i += w) {
        const row = list.slice(i, i + w);
        while (row.length < w) row.push(na);
        rows.push(row);
      }
      this.cachedMatrix = rows;
      return { result: rows };
    } else if (this.op === "wrapcols") {
      const list = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const w = Math.round(inputs.wrapCount?.[0] ?? this.literals.wrapCount ?? 3);
      if (!list || w < 1) return { result: null };
      const na = solError("#N/A", "Padded: the list doesn't fill the last column") as unknown as Cell;
      const nCols = Math.ceil(list.length / w);
      const mat: CellMat = Array.from({ length: w }, () => Array<Cell>(nCols).fill(na));
      for (let i = 0; i < list.length; i++) mat[i % w][Math.floor(i / w)] = list[i];
      this.cachedMatrix = mat;
      return { result: mat };
    } else if (this.op === "tocol") {
      const m = toAnyMatrix(inputs.matrix?.[0]);
      if (!m) return { result: null };
      this.cachedList = m.flat();
      return { result: this.cachedList };
    } else {
      const m = toAnyMatrix(inputs.matrix?.[0]);
      if (!m) return { result: null };
      this.cachedList = matTranspose(m).flat();
      return { result: this.cachedList };
    }
  }
}

// ─── CHOOSEROWS / CHOOSECOLS ──────────────────────────────────────────────────

export type TableSelectOp = "chooserows" | "choosecols";

export const TABLE_SELECT_OP_META = {
  chooserows: { label: "CHOOSEROWS", description: "Select rows from a table by 1-based index list. Excel: CHOOSEROWS." },
  choosecols: { label: "CHOOSECOLS", description: "Select columns from a table by 1-based index list. Excel: CHOOSECOLS." },
} satisfies Record<TableSelectOp, { label: string; description: string }>;

export class TableSelectNode extends ClassicPreset.Node {
  label: string;
  op: TableSelectOp;
  cachedResult: CellMat | null = null;
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: TableSelectOp }) {
    super("TableSelect");
    this.op    = init?.op    ?? "chooserows";
    this.label = init?.label ?? TABLE_SELECT_OP_META[this.op].label;
    // `any` matrix (text/date too); indices stay a numeric list.
    this.addInput("matrix",  anyTableIn("Matrix"));
    this.addInput("indices", listIn(this.op === "chooserows" ? "Row indices (1-based)" : "Col indices (1-based)"));
    this.addOutput("result", anyTableOut("Result"));
  }

  data(inputs: { matrix?: unknown[]; indices?: number[][] }) {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    const idx = inputs.indices?.[0] ?? null;
    if (!m || !idx) { this.cachedResult = null; return { result: null }; }
    if (this.op === "chooserows") {
      const rows = matRows(m);
      const result = idx.map(i => {
        const r = i < 0 ? rows + i : i - 1;
        return (r >= 0 && r < rows) ? [...m[r]] : Array(matCols(m)).fill(NaN) as Cell[];
      });
      this.cachedResult = result;
    } else {
      const cols = matCols(m);
      const result = m.map(row =>
        idx.map(j => {
          const c = j < 0 ? cols + j : j - 1;
          return (c >= 0 && c < cols) ? row[c] : NaN;
        })
      );
      this.cachedResult = result;
    }
    return { result: this.cachedResult };
  }
}

// ─── ROWS / COLUMNS (table dimension info) ────────────────────────────────────

export class TableInfoNode extends ClassicPreset.Node {
  label: string;
  cachedRows: number | null = null;
  cachedCols: number | null = null;
  width = 200; height = 200;

  constructor(init?: { label?: string }) {
    super("TableInfo");
    this.label = init?.label ?? "Table Info";
    // A `frame` input: a frame flows in directly, and a raw matrix widens in
    // (coerceInputs builds a default-header frame). So Table Info inspects either a
    // matrix or a frame; 1-D lengths are List Length's job.
    this.addInput("matrix", frameIn("Table"));
    this.addOutput("rows", numOut("ROWS"));
    this.addOutput("cols", numOut("COLUMNS"));
  }

  data(inputs: { matrix?: unknown[] }) {
    const input = inputs.matrix?.[0];
    // A Frame is a distinct type (named columns), not a row-major matrix, so
    // toAnyMatrix would read it as a scalar (1×1). Report its real shape directly.
    if (isFrameValue(input)) {
      this.cachedRows = frameRowCount(input);
      this.cachedCols = input.columns.length;
      return { rows: this.cachedRows, cols: this.cachedCols };
    }
    const m = toAnyMatrix(input);
    this.cachedRows = m ? matRows(m) : null;
    this.cachedCols = m ? matCols(m) : null;
    return { rows: this.cachedRows, cols: this.cachedCols };
  }
}
