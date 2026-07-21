import { ClassicPreset } from "rete";
import { numIn, numOut, listIn, anyIn, anyListIn, anyTableIn, anyTableOut, adoptiveTableIn, adoptiveTableOut, adoptiveListOut, tableIn, tableOut, frameIn } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { toAnyMatrix, type Cell } from "./coerce";
import { tableSocket, strTableSocket, dateTableSocket, logicalTableSocket } from "../sockets";
import { parseCsvRows } from "../csv";
import { solError, isSolError, type SolError } from "../errorValue";
import { isFrameValue, frameRowCount, coerceFrameCell } from "../frame";
import { carryMatrixUnit, withMatrixUnit, matrixUnitOf, sharedMatrixUnit } from "../unitValue";
import { applyFcUnit } from "../unitBridge";
import { taggedListFromMatrix, matrixCellsFromList } from "../unitColumn";

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

function matUnit(n: number, offDiag: number | null = 0): Mat {
  const k = Math.round(n);
  if (k < 1) return [];
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 1 : offDiag)));
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

// ─── TABLE INPUT ──────────────────────────────────────────────────────────────
// A LITERAL source, exactly like Frame Input (subsystem-invariants "Frame Input
// is a LITERAL source"): `tableText` stores the raw text the user typed, the
// typed matrix is DERIVED at compute, and the grid editor edits the raw cells —
// never a parse→serialize round trip (that would silently coerce bad text
// away). A blank cell is null (missing); an unparseable cell is NaN — dirty
// data with the quiet display affordance, deliberately NOT an error badge
// (1.0-tail #6). One homogeneous element type per table, switched by the
// card's SegToggle (the List Input pattern; mixed columns is Frame Input's job).

export type TableElemType = "number" | "string" | "date" | "logical";

export const TABLE_ELEM_SOCKET = {
  number: tableSocket,
  string: strTableSocket,
  date: dateTableSocket,
  logical: logicalTableSocket,
} as const;

/** Split the literal text into RAW CELLS — lossless (parseCsvRows handles
 *  quoting); ragged rows pad with "" so the grid always shows a rectangle. */
export function tableRawCells(text: string): string[][] {
  // keepBlankLines: the raw text is the STORED TRUTH — a blank line the user
  // typed is a row of missing cells (author 2026-07-16: the editors never coerce
  // the Source; only the DERIVED matrix coerces, blank → null). Dropping blank
  // lines here didn't just blank the derived row — the grid popup re-serializes
  // through this parse, so a popup save permanently DELETED the row from the text.
  // Blank rows stay wherever they are — leading, interior, AND trailing (author
  // 2026-07-16: tables get set up with blank rows for operations). The only thing
  // dropped is the phantom row from the text's final newline TERMINATOR
  // (parseCsvRows handles that distinction).
  const raw = parseCsvRows(text, { keepBlankLines: true });
  if (raw.length === 0) return [];
  let cols = raw.reduce((m, r) => Math.max(m, r.length), 0);
  // A TRAILING all-empty column is a typing artifact (a trailing comma on each
  // line), not data — left in, it silently promotes a list to a 2-D table and
  // flips downstream shape rules (Filter's predicate refuses genuine 2-D).
  // Interior blanks are real missing cells and stay.
  while (cols > 1 && raw.every((r) => (r[cols - 1] ?? "").trim() === "")) cols--;
  return raw.map((r) => Array.from({ length: cols }, (_, j) => (r[j] ?? "").trim()));
}

/** Serialize raw cells back to the text form — re-quoting a cell that would
 *  otherwise be ambiguous (RFC 4180), so the round trip is verbatim. The
 *  friendly ", " separator drops to a bare "," when any cell needs quoting: a
 *  quoted field must start immediately after the comma (Papa is RFC-strict —
 *  a space before the opening quote de-quotes the field). */
export function rawCellsToText(cells: string[][]): string {
  const needsQuote = (c: string) => /[",\n]/.test(c);
  const q = (c: string) => (needsQuote(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const sep = cells.some((r) => r.some(needsQuote)) ? "," : ", ";
  const lines = cells.map((r) => r.map(q).join(sep));
  const text = lines.join("\n");
  // A single-column TRAILING blank row serializes as an empty final line — which
  // reads as a bare newline terminator on the way back in. Terminate it with its
  // own "\n" so the round trip keeps the row (multi-column blank rows serialize
  // as ", " and never hit this).
  return lines.length > 0 && lines[lines.length - 1] === "" ? text + "\n" : text;
}

/** Derive the typed matrix from raw cells via the frame family's OWN per-type
 *  coercion (coerceFrameCell): blank → null, an unparseable number/date → NaN
 *  (dirty data), a bad logical → null (coerceLogical's contract) — so Table
 *  Input's bad-cell semantics are Frame Input's by construction. */
export function deriveTable(cells: string[][], dt: TableElemType): CellMat {
  return cells.map((row) => row.map((c) => coerceFrameCell(dt, c) as Cell));
}

export class TableInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CellMat | null = null;
  tableText: string = "1, 0\n0, 1";
  dataType: TableElemType;
  /** The homogeneous unit AUTHORED on this literal source (D20) — an FC unit id
   *  ("km", "usd", "none"). A LITERAL source may tag its own unit, exactly like a
   *  Frame Input column; only applies to a NUMBER table. Persisted (whitelisted). */
  unit: string = "none";
  width = 220; height = 250;

  constructor(init?: { label?: string; tableText?: string; dataType?: TableElemType; unit?: string }) {
    super("TableInput");
    this.label = init?.label ?? "Table Input";
    if (init?.tableText != null) this.tableText = init.tableText;
    this.dataType = init?.dataType ?? "number";
    if (init?.unit != null) this.unit = init.unit;
    this.addOutput("table", new ClassicPreset.Output(TABLE_ELEM_SOCKET[this.dataType], "Table"));
    // Dimensions are available from the ROWS / COLUMNS node, so no redundant
    // number outputs here — just the table.
  }

  /** The raw text cells — the grid editor's truth. */
  rawCells(): string[][] { return tableRawCells(this.tableText); }

  /** Switch the element type IN PLACE (re-types the output socket; the component
   *  follows with retypeOutputCables — an in-place retype fires no connection
   *  event). Returns false when unchanged. */
  setDataType(dt: TableElemType): boolean {
    if (this.dataType === dt) return false;
    this.dataType = dt;
    const out = this.outputs.table;
    if (out) out.socket = TABLE_ELEM_SOCKET[dt];
    return true;
  }

  data() {
    const cells = this.rawCells();
    let result = cells.length ? deriveTable(cells, this.dataType) : null;
    // A NUMBER table may carry one homogeneous unit (D20), authored here like a
    // Frame Input column. applyFcUnit interprets the as-typed cells AS this unit
    // and tags a COPY of the outer array (cells stay bare). Non-number tables and
    // "none" pass through untagged.
    if (result && this.dataType === "number" && this.unit !== "none") {
      result = applyFcUnit(result, this.unit) as CellMat;
    }
    this.cachedResult = result;
    return { table: this.cachedResult };
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
  /** Off-diagonal fill: 0 (Excel's MUNIT) or blank (null — missing, so the
   *  off-diagonal stays out of sums/counts and element-wise combines). */
  offDiag: "zero" | "blank" = "zero";
  width = 180; height = 190;

  constructor(init?: { label?: string; offDiag?: "zero" | "blank" }) {
    super("TableUnit");
    this.label = init?.label ?? "MUNIT";
    if (init?.offDiag) this.offDiag = init.offDiag;
    this.addInput("n", numIn("Size n"));
    this.addOutput("result", tableOut("n×n identity"));
  }

  data(inputs: { n?: number[] }) {
    const n = inputs.n?.[0] ?? this.literals.n ?? 3;
    this.cachedResult = matUnit(n, this.offDiag === "blank" ? null : 0);
    return { result: this.cachedResult };
  }
}

// ─── TRANSPOSE ────────────────────────────────────────────────────────────────

export class TableTransposeNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  cachedResult: CellMat | null = null;
  width = 180; height = 180;

  constructor(init?: { label?: string }) {
    super("TableTranspose");
    this.label = init?.label ?? "TRANSPOSE";
    // Element-agnostic reshape: an `any` input accepts any matrix (text/date too),
    // and the output is the 2-D wildcard `anytable` (see sockets.ts).
    this.addInput("matrix", adoptiveTableIn("Matrix"));
    this.addOutput("result", adoptiveTableOut("Transposed"));
  }

  data(inputs: { matrix?: unknown[] }) {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    // A structural reshape preserves the homogeneous matrix unit (D20): the cells
    // are the same, just rearranged, so carry the tag onto the fresh output array.
    this.cachedResult = m ? carryMatrixUnit(matTranspose(m), m) : null;
    return { result: this.cachedResult };
  }
}

// ─── HSTACK / VSTACK — the 2-D rungs of the append ladder (decisions.md D15) ──
// N extensible element-agnostic rows (anytable — a scalar widens to 1×1, a list
// to ONE ROW per the lattice rule), stacked in row order. Ragged inputs pad
// with #N/A cells exactly like Excel's VSTACK/HSTACK — a hole is visible and
// recoverable (IFNA/Fill), where the old whole-result #SHAPE! made the common
// "stack a 3-list on a 5-list" case unusable.

/** One #N/A pad cell per data() pass (SolErrors are immutable — sharing is fine). */
function padCell(what: string): Cell {
  return solError("#N/A", `Padded: this input is ${what} than the largest one`);
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
    // The result carries a unit only when EVERY part shares the same one (D20).
    withMatrixUnit(out, sharedMatrixUnit(mats));
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
    // The result carries a unit only when EVERY part shares the same one (D20).
    withMatrixUnit(out, sharedMatrixUnit(mats));
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
  /** Keeps `UnitCell` tags on its LIST input (WRAPROWS/WRAPCOLS): it converts a
   *  uniform-unit list into a whole-grid matrix unit itself (see coerceInputs). The
   *  matrix→list direction (TOCOL/TOROW) reads the grid's Symbol tag, unaffected. */
  unitAware = true;
  label: string;
  op: TableReshapeOp;
  cachedList: Cell[] | null = null;
  cachedMatrix: CellMat | null = null;
  literals: Record<string, number> = { wrapCount: 3 };
  width = 180; height = 200;

  /** Element-preserving, rank-CROSSING: the output adopts the input's element
   *  FAMILY at its own declared rank (strlist → WRAPROWS → strtable; strtable →
   *  flatten → strlist) — the projectTypeToBase half of output adoption. */
  passthrough = (): PassthroughSpec[] => [{
    output: "result",
    inputs: [this.op === "wraprows" || this.op === "wrapcols" ? "list" : "matrix"],
    combine: "single",
  }];

  constructor(init?: { label?: string; op?: TableReshapeOp }) {
    super("TableReshape");
    this.op    = init?.op    ?? "wraprows";
    this.label = init?.label ?? TABLE_RESHAPE_OP_META[this.op].label;
    const wraps = this.op === "wraprows" || this.op === "wrapcols";
    // Element-agnostic, rank-honest: wrapping takes a 1-D list of any family
    // (`anylist`) and produces a matrix (the 2-D wildcard `anytable`);
    // flattening produces a 1-D list of unknown element type (`anylist`). The
    // outputs are ADOPTIVE at their rank — they color to the incoming family.
    if (wraps) {
      this.addInput("list",      anyListIn("List"));
      this.addInput("wrapCount", numIn("Wrap count"));
      this.addOutput("result", adoptiveTableOut("Table"));
    } else {
      this.addInput("matrix", anyTableIn("Matrix"));
      this.addOutput("result", adoptiveListOut("List"));
    }
  }

  data(inputs: { list?: unknown[]; wrapCount?: number[]; matrix?: unknown[] }) {
    this.cachedList = null;
    this.cachedMatrix = null;
    // Both wraps pad the leftover cells with #N/A — Excel's default pad_with.
    if (this.op === "wraprows") {
      // List → matrix (rank change): a uniform-unit list gives a matrix with that
      // one whole-grid unit (D20); the cells drop to bare magnitudes, mixed strips.
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const w = Math.round(inputs.wrapCount?.[0] ?? this.literals.wrapCount ?? 3);
      if (!raw || w < 1) return { result: null };
      const { mags: list, unit } = matrixCellsFromList(raw);
      const na: Cell = solError("#N/A", "Padded: the list doesn't fill the last row");
      const rows: CellMat = [];
      for (let i = 0; i < list.length; i += w) {
        const row = list.slice(i, i + w) as Cell[];
        while (row.length < w) row.push(na);
        rows.push(row);
      }
      withMatrixUnit(rows, unit);
      this.cachedMatrix = rows;
      return { result: rows };
    } else if (this.op === "wrapcols") {
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const w = Math.round(inputs.wrapCount?.[0] ?? this.literals.wrapCount ?? 3);
      if (!raw || w < 1) return { result: null };
      const { mags: list, unit } = matrixCellsFromList(raw);
      const na: Cell = solError("#N/A", "Padded: the list doesn't fill the last column");
      const nCols = Math.ceil(list.length / w);
      const mat: CellMat = Array.from({ length: w }, () => Array<Cell>(nCols).fill(na));
      for (let i = 0; i < list.length; i++) mat[i % w][Math.floor(i / w)] = list[i] as Cell;
      withMatrixUnit(mat, unit);
      this.cachedMatrix = mat;
      return { result: mat };
    } else if (this.op === "tocol") {
      // Matrix → list (rank change): the grid's one unit becomes per-cell list tags.
      const m = toAnyMatrix(inputs.matrix?.[0]);
      if (!m) return { result: null };
      this.cachedList = taggedListFromMatrix(m.flat(), matrixUnitOf(m)) as Cell[];
      return { result: this.cachedList };
    } else {
      const m = toAnyMatrix(inputs.matrix?.[0]);
      if (!m) return { result: null };
      this.cachedList = taggedListFromMatrix(matTranspose(m).flat(), matrixUnitOf(m)) as Cell[];
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
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  op: TableSelectOp;
  cachedResult: CellMat | SolError | null = null;
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: TableSelectOp }) {
    super("TableSelect");
    this.op    = init?.op    ?? "chooserows";
    this.label = init?.label ?? TABLE_SELECT_OP_META[this.op].label;
    // `any` matrix (text/date too); indices stay a numeric list.
    this.addInput("matrix",  adoptiveTableIn("Matrix"));
    this.addInput("indices", listIn(this.op === "chooserows" ? "Row indices (1-based)" : "Col indices (1-based)"));
    this.addOutput("result", adoptiveTableOut("Result"));
  }

  data(inputs: { matrix?: unknown[]; indices?: number[][] }): { result: CellMat | SolError | null } {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    const idx = inputs.indices?.[0] ?? null;
    if (!m || !idx) { this.cachedResult = null; return { result: null }; }
    // Excel: a 1-based index (negative counts from the end); a fractional index
    // truncates toward zero; ANY zero/out-of-range index errors the whole call
    // with #VALUE! — the same edge convention EXPAND uses for a shrink.
    const kind = this.op === "chooserows" ? "row" : "column";
    const size = this.op === "chooserows" ? matRows(m) : matCols(m);
    const resolved: number[] = [];
    for (const i of idx) {
      const t = Math.trunc(i);
      const p = t < 0 ? size + t : t - 1;
      if (!(p >= 0 && p < size)) {
        const e = solError("#VALUE!", `${TABLE_SELECT_OP_META[this.op].label}: ${kind} index ${i} is out of range for a table with ${size} ${kind}s`);
        this.cachedResult = e;
        return { result: e };
      }
      resolved.push(p);
    }
    this.cachedResult = carryMatrixUnit(
      this.op === "chooserows"
        ? resolved.map(r => [...m[r]])
        : m.map(row => resolved.map(c => row[c])),
      m,
    );
    return { result: this.cachedResult };
  }
}

// ─── TAKE / DROP (2-D) ────────────────────────────────────────────────────────
// Excel's TAKE/DROP are 2-D edge selectors: rows AND columns in one call,
// positive counts from the start, negative from the end. The 1-D Take/Drop
// (list.ts) stay the list spellings; these are the table ones. 0 (the default)
// means "all" for TAKE and "none" for DROP, standing in for Excel's omitted
// argument.

export type TableTakeDropOp = "take" | "drop";

export const TABLE_TAKEDROP_OP_META = {
  take: { label: "TAKE (table)", description: "Keep rows/columns from a table's edges: positive counts take from the start, negative from the end, 0 takes all. A bare list counts as ONE ROW — use Cols to take its elements. Excel: TAKE(array, rows, [cols])." },
  drop: { label: "DROP (table)", description: "Remove rows/columns from a table's edges: positive counts drop from the start, negative from the end, 0 drops none. Excel: DROP(array, rows, [cols])." },
} satisfies Record<TableTakeDropOp, { label: string; description: string }>;

export class TableTakeDropNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  op: TableTakeDropOp;
  cachedResult: CellMat | null = null;
  literals: Record<string, number> = { rows: 0, cols: 0 };
  width = 190; height = 250;

  constructor(init?: { label?: string; op?: TableTakeDropOp }) {
    super("TableTakeDrop");
    this.op    = init?.op    ?? "take";
    this.label = init?.label ?? TABLE_TAKEDROP_OP_META[this.op].label;
    // Labels stay op-neutral — the op dropdown swaps at runtime but sockets
    // (and their labels) are fixed at construction.
    this.addInput("matrix", adoptiveTableIn("Table"));
    this.addInput("rows",   numIn("Rows (± from end)"));
    this.addInput("cols",   numIn("Cols (± from end)"));
    this.addOutput("result", adoptiveTableOut("Result"));
  }

  // 0 = identity for both ops ("take all" / "drop none", Excel's omitted arg).
  private takeDrop<T>(arr: T[], n: number): T[] {
    if (n === 0) return arr;
    if (this.op === "take") {
      // Counts past the size keep everything (Excel's behavior).
      return n > 0 ? arr.slice(0, n) : arr.slice(Math.max(0, arr.length + n));
    }
    // Drop past the size leaves an empty result, not an error.
    return n > 0 ? arr.slice(Math.min(n, arr.length)) : arr.slice(0, Math.max(0, arr.length + n));
  }

  data(inputs: { matrix?: unknown[]; rows?: number[]; cols?: number[] }) {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    if (!m || m.length === 0) { this.cachedResult = null; return { result: null }; }
    const nRows = Math.round(inputs.rows?.[0] ?? this.literals.rows ?? 0);
    const nCols = Math.round(inputs.cols?.[0] ?? this.literals.cols ?? 0);
    const result = carryMatrixUnit(this.takeDrop(m, nRows).map((r) => [...this.takeDrop(r, nCols)]), m);
    this.cachedResult = result;
    return { result };
  }
}

// ─── EXPAND (grow a table, padding new cells) ─────────────────────────────────
// The 2-D Pad: grow to R×C, new cells fill with the wired Fill value or #N/A
// (Excel's default). Shrinking is #VALUE! like Excel — TAKE is the shrinker.

export class ExpandNode extends ClassicPreset.Node {
  /** Element-preserving reshape: its output adopts the input\'s type (a reversed
   *  date list stays a date list) — see passthrough.ts. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  cachedResult: CellMat | SolError | null = null;
  literals: Record<string, number> = { rows: 0, cols: 0 };
  width = 190; height = 260;

  constructor(init?: { label?: string }) {
    super("Expand");
    this.label = init?.label ?? "EXPAND";
    this.addInput("matrix", adoptiveTableIn("Table"));
    this.addInput("rows",   numIn("Rows (0 = keep)"));
    this.addInput("cols",   numIn("Cols (0 = keep)"));
    this.addInput("fill",   anyIn("Fill"));
    this.addOutput("result", adoptiveTableOut("Expanded"));
  }

  data(inputs: { matrix?: unknown[]; rows?: number[]; cols?: number[]; fill?: unknown[] }): { result: CellMat | SolError | null } {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    if (!m || m.length === 0) { this.cachedResult = null; return { result: null }; }
    const curR = matRows(m), curC = matCols(m);
    const reqR = Math.round(inputs.rows?.[0] ?? this.literals.rows ?? 0);
    const reqC = Math.round(inputs.cols?.[0] ?? this.literals.cols ?? 0);
    const R = reqR > 0 ? reqR : curR;
    const C = reqC > 0 ? reqC : curC;
    if (R < curR || C < curC) {
      const e = solError("#VALUE!", `EXPAND can only grow: the table is ${curR}×${curC}, the target ${R}×${C}. Use TAKE to shrink`);
      this.cachedResult = e;
      return { result: e };
    }
    // Unwired Fill pads with `null` (first-class missing — author 2026-07-16), NOT
    // Excel's #N/A: wire the NA node into Fill to get Excel's pad_with-omitted form.
    const fill = (inputs.fill?.[0] ?? null) as Cell;
    const result: CellMat = [];
    for (let i = 0; i < R; i++) {
      const src = i < curR ? m[i] : [];
      const row: Cell[] = [];
      for (let j = 0; j < C; j++) row.push(j < src.length ? src[j] : fill);
      result.push(row);
    }
    // Growing keeps the grid's homogeneous unit (D20) — the pad Fill reads in that
    // same unit, so carry the tag onto the expanded array.
    carryMatrixUnit(result, m);
    this.cachedResult = result;
    return { result };
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
