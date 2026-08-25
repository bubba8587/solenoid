import { ClassicPreset } from "rete";
import { matRows, matCols, matTranspose, matUnit, matDiag, outerProduct, asNumericMatrix, matMul, matDet, matInverse, matTrace, matRank, matNorm, matSolve, matEigh, wrapCells, stackH, stackV, chooseAxis, expandMat, setCells } from "./matrixOps";
import { takeSlice, dropSlice } from "./listOps";
import { numIn, numOut, listIn, numListIn, numListOut, anyIn, anyDataIn, anyListIn, anyTableIn, adoptiveTableIn, adoptiveTableOut, adoptiveListOut, adoptiveDataOut, tableIn, tableOut, frameIn, readInput } from "./shared";
import { pickSlot, pairIdsFromKeys } from "./logic";
import type { PassthroughSpec } from "./passthrough";
import { toAnyMatrix, matrixShape, type Cell } from "./coerce";
import { tableSocket, strTableSocket, dateTableSocket, logicalTableSocket } from "../sockets";
import { parseCsvRows } from "../csv";
import { solError, isSolError, type SolError } from "../errorValue";
import { isFrameValue, frameRowCount, coerceFrameCell } from "../frame";
import { carryMatrixUnit, withMatrixUnit, matrixUnitOf, sharedMatrixUnit, isUnitCell } from "../unitValue";
import { applyFcUnit } from "../unitBridge";
import { taggedListFromMatrix, matrixCellsFromList } from "../unitColumn";

// ─── Internal helpers ─────────────────────────────────────────────────────────

type Mat = (number | null)[][];  // numeric matrix; a null cell is MISSING (linear-algebra ops reject it)
type CellMat = Cell[][];          // element-agnostic matrix (the pure-reshape ops)

// ─── TABLE INPUT ──────────────────────────────────────────────────────────────
// A LITERAL source: the grid editor edits the RAW cells, never a parse→serialize
// round trip, which would silently coerce bad text away.

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
  // keepBlankLines: the popup re-serializes through this parse, so dropping a blank
  // line here permanently DELETES that row on a popup save.
  const raw = parseCsvRows(text, { keepBlankLines: true });
  if (raw.length === 0) return [];
  let cols = raw.reduce((m, r) => Math.max(m, r.length), 0);
  // A TRAILING all-empty column is a typing artifact — left in, it promotes a list
  // to a 2-D table and flips downstream shape rules. Interior blanks stay.
  while (cols > 1 && raw.every((r) => (r[cols - 1] ?? "").trim() === "")) cols--;
  return raw.map((r) => Array.from({ length: cols }, (_, j) => (r[j] ?? "").trim()));
}

/** Serialize raw cells back to text, re-quoting ambiguous cells so the round trip is
 *  verbatim. The ", " separator drops to "," when any cell needs quoting — a quoted
 *  field must start immediately after the comma or the parser de-quotes it. */
export function rawCellsToText(cells: string[][]): string {
  const needsQuote = (c: string) => /[",\n]/.test(c);
  const q = (c: string) => (needsQuote(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const sep = cells.some((r) => r.some(needsQuote)) ? "," : ", ";
  const lines = cells.map((r) => r.map(q).join(sep));
  const text = lines.join("\n");
  // A single-column TRAILING blank row would read back as a bare newline terminator;
  // its own "\n" keeps the row across the round trip.
  return lines.length > 0 && lines[lines.length - 1] === "" ? text + "\n" : text;
}

/** Derives via the frame family's own `coerceFrameCell`, so Table Input's bad-cell
 *  semantics are Frame Input's by construction. */
export function deriveTable(cells: string[][], dt: TableElemType): CellMat {
  return cells.map((row) => row.map((c) => coerceFrameCell(dt, c) as Cell));
}

export class TableInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CellMat | null = null;
  tableText: string = "1, 0\n0, 1";
  dataType: TableElemType;
  /** The homogeneous unit AUTHORED on this literal source (unitGranularity) — an FC unit id;
   *  NUMBER tables only. Persisted (whitelisted). */
  unit: string = "none";
  width = 220; height = 250;

  constructor(init?: { label?: string; tableText?: string; dataType?: TableElemType; unit?: string }) {
    super("TableInput");
    this.label = init?.label ?? "Table Input";
    if (init?.tableText != null) this.tableText = init.tableText;
    this.dataType = init?.dataType ?? "number";
    if (init?.unit != null) this.unit = init.unit;
    this.addOutput("table", new ClassicPreset.Output(TABLE_ELEM_SOCKET[this.dataType], "Table"));
  }

  /** The raw text cells — the grid editor's truth. */
  rawCells(): string[][] { return tableRawCells(this.tableText); }

  /** Re-types the output socket IN PLACE, which fires no connection event — the
   *  component must follow with retypeOutputCables. */
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
    // applyFcUnit tags a COPY of the outer array; cells stay bare.
    if (result && this.dataType === "number" && this.unit !== "none") {
      result = applyFcUnit(result, this.unit) as CellMat;
    }
    this.cachedResult = result;
    return { table: this.cachedResult };
  }
}

// ─── MDETERM / MINVERSE ───────────────────────────────────────────────────────

export type MatDetOp = "mdeterm" | "minverse" | "trace" | "rank" | "norm";

export const MAT_DET_OP_META = {
  mdeterm:  { label: "MDETERM",  description: "Determinant of a square matrix. Excel: MDETERM." },
  minverse: { label: "MINVERSE", description: "Inverse of a square matrix: result × input = identity. Excel: MINVERSE." },
  trace:    { label: "TRACE",    description: "Sum of the main diagonal. numpy trace, R sum(diag(m))." },
  rank:     { label: "MATRIXRANK", description: "Rank: the number of linearly independent rows (Gaussian elimination with a tolerance). numpy matrix_rank, R qr(m)$rank." },
  norm:     { label: "NORM",     description: "Frobenius norm: √Σ every cell squared (numpy.linalg.norm default, R norm(m, \"F\")). Excel: SQRT(SUMSQ(range))." },
} satisfies Record<MatDetOp, { label: string; description: string }>;
const MAT_DET_SCALAR: ReadonlySet<MatDetOp> = new Set(["mdeterm", "trace", "rank", "norm"]);

export class MatDetNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    matrix: "The matrix must be square, with every cell filled.",
  };

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
    this.addOutput("result", MAT_DET_SCALAR.has(this.op) ? numOut(MAT_DET_OP_META[this.op].label) : tableOut("Inverse"));
  }

  /** Retypes the output in place (number ↔ table) — the component must call
   *  retypeOutputCables afterwards (no connection event fires on an in-place swap). */
  setOp(next: MatDetOp): void {
    if (next === this.op) return;
    this.op = next;
    const out = this.outputs.result;
    if (!out) return;
    const spec = MAT_DET_SCALAR.has(next) ? numOut(MAT_DET_OP_META[next].label) : tableOut("Inverse");
    out.socket = spec.socket;
    out.label = spec.label;
  }

  data(inputs: { matrix?: CellMat[] }): { result: number | Mat | SolError | null } {
    const raw = inputs.matrix?.[0] ?? null;
    this.cachedScalar = null;
    this.cachedMatrix = null;
    if (!raw) return { result: null };
    // An anytable could carry text — reject non-numeric matrices up front.
    const m = asNumericMatrix(raw);
    const scalar = MAT_DET_SCALAR.has(this.op);
    if (isSolError(m)) {
      if (scalar) this.cachedScalar = m; else this.cachedMatrix = m;
      return { result: m };
    }
    // rank and norm take any shape; the rest need a square matrix.
    if (this.op === "rank")  { const r = matRank(m);  this.cachedScalar = r; return { result: r }; }
    if (this.op === "norm")  { const r = matNorm(m);  this.cachedScalar = r; return { result: r }; }
    // Non-square is a dimension problem (#SHAPE!); a rejected square one is singular.
    if (matRows(m) !== matCols(m)) {
      const err = solError("#SHAPE!", "Matrix must be square");
      if (scalar) this.cachedScalar = err; else this.cachedMatrix = err;
      return { result: err };
    }
    if (this.op === "trace") { const r = matTrace(m); this.cachedScalar = r; return { result: r }; }
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
        const err = solError("#DIV/0!", "Matrix is singular. It has no inverse");
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
  static socketDocs: Record<string, string> = {
    b: "Its row count must equal A's column count.",
  };

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
    // A blank size means an unknown grid, not a default 3×3.
    const n = readInput(inputs.n, this.literals.n ?? 3);
    if (n === null) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = matUnit(n, this.offDiag === "blank" ? null : 0);
    return { result: this.cachedResult };
  }
}

// ─── DIAGONAL ───────────────────────────────────────────────────────────────
// numpy.diag: a list becomes the diagonal of a square matrix. Off-diagonal fill is
// MUNIT's toggle — 0, or blank (null) so it stays out of sums/counts.
export class TableDiagNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Mat | null = null;
  /** Off-diagonal fill: 0 (numpy.diag) or blank (null — out of sums/counts). Shares MUNIT's toggle. */
  offDiag: "zero" | "blank" = "zero";
  width = 180; height = 190;

  constructor(init?: { label?: string; offDiag?: "zero" | "blank" }) {
    super("TableDiag");
    this.label = init?.label ?? "DIAGONAL";
    if (init?.offDiag) this.offDiag = init.offDiag;
    this.addInput("diag", numListIn("Diagonal"));
    this.addOutput("result", tableOut("Diagonal matrix"));
  }

  data(inputs: { diag?: (number | null)[][] }) {
    const values = inputs.diag?.[0] ?? null;
    // No list means an unknown diagonal, not a 0×0 matrix.
    if (!values || values.length === 0) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = matDiag(values, this.offDiag === "blank" ? null : 0);
    return { result: this.cachedResult };
  }
}

// ─── OUTER ────────────────────────────────────────────────────────────────────
// numpy.outer: two lists → the matrix of their products a[i]·b[j].
export class TableOuterNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Mat | null = null;
  width = 180; height = 200;

  constructor(init?: { label?: string }) {
    super("TableOuter");
    this.label = init?.label ?? "OUTER";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", tableOut("Outer product"));
  }

  data(inputs: { a?: (number | null)[][]; b?: (number | null)[][] }) {
    const a = inputs.a?.[0] ?? null;
    const b = inputs.b?.[0] ?? null;
    if (!a || !b || a.length === 0 || b.length === 0) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = outerProduct(a, b);
    return { result: this.cachedResult };
  }
}

// ─── TRANSPOSE ────────────────────────────────────────────────────────────────

export class TableTransposeNode extends ClassicPreset.Node {
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  cachedResult: CellMat | null = null;
  width = 180; height = 180;

  constructor(init?: { label?: string }) {
    super("TableTranspose");
    this.label = init?.label ?? "TRANSPOSE";
    this.addInput("matrix", adoptiveTableIn("Matrix"));
    this.addOutput("result", adoptiveTableOut("Transposed"));
  }

  data(inputs: { matrix?: unknown[] }) {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    // A structural reshape preserves the homogeneous matrix unit (unitGranularity) — carry the
    // tag onto the fresh output array.
    this.cachedResult = m ? carryMatrixUnit(matTranspose(m), m) : null;
    return { result: this.cachedResult };
  }
}

// ─── HSTACK / VSTACK — the 2-D rungs of the append ladder (appendLadder) ───────────────
// Ragged inputs pad with #N/A cells (recoverable via IFNA/Fill) rather than failing
// the whole result with #SHAPE!.

/** One #N/A pad cell per data() pass (SolErrors are immutable — sharing is fine). */
/** WRAPROWS/WRAPCOLS pad_with: a wired non-blank Fill overrides Excel's default #N/A
 *  pad. Blank (null) or unwired keeps #N/A — matching the formula surface's wrapPad. */
function wrapPadCell(fill: unknown[] | undefined, what: string): Cell {
  const v = (fill?.[0] ?? null) as Cell;
  return v != null ? v : solError("#N/A", `Padded: the list doesn't fill the last ${what}`);
}

/** A matrix carries ONE whole-grid unit tag, never per-cell `UnitCell`s (unitGranularity): reduce
 *  a widened LIST row to bare magnitudes plus the one unit its cells share (undefined
 *  when they disagree). An already-bare matrix comes back untouched. */
function demoteUnitCells(m: CellMat): CellMat {
  if (!m.some((row) => row.some(isUnitCell))) return m;
  const { mags, unit } = matrixCellsFromList(m.flat());
  const bare: CellMat = [];
  let i = 0;
  for (const row of m) { bare.push(mags.slice(i, i + row.length) as Cell[]); i += row.length; }
  return withMatrixUnit(bare, unit);
}

/** Shared extensible-row plumbing for the two stackers. */
abstract class StackNodeBase extends ClassicPreset.Node {
  /** Rows keep their `UnitCell` tags at the boundary so `demoteUnitCells` can lift a
   *  dimensioned LIST row to a grid unit — tags riding INTO the matrix break unitGranularity. */
  unitAware = true;
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
    this.addOutput("result", adoptiveTableOut("Stacked"));
  }

  /** Element-preserving: the result is the rows' cells rearranged, so it adopts the
   *  agreed row type instead of decaying to a neutral `anytable`. */
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: this.valueInputKeys(), combine: "agree" }];

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

  /** Wired inputs as matrices in row order (empties drop out), each reduced to the
   *  unitGranularity matrix shape on the way in. */
  protected matsOf(inputs: Record<string, unknown[] | undefined>): CellMat[] {
    return this.valueInputKeys()
      .map((k) => toAnyMatrix(inputs[k]?.[0]))
      .filter((m): m is CellMat => !!m && m.length > 0)
      .map(demoteUnitCells);
  }
}

export class HStackTableNode extends StackNodeBase {
  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("HStackTable", "HSTACK", init);
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    const mats = this.matsOf(inputs);
    if (mats.length === 0) { this.cachedResult = null; return { result: null }; }
    const out = stackH(mats) as CellMat;
    withMatrixUnit(out, sharedMatrixUnit(mats));
    this.cachedResult = out;
    return { result: out };
  }
}

// VSTACK is also the lists→table path: a bare list widens to ONE ROW, so stacking
// two lists yields a 2×n table.
export class VStackNode extends StackNodeBase {
  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("VStack", "VSTACK", init);
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    const mats = this.matsOf(inputs);
    if (mats.length === 0) { this.cachedResult = null; return { result: null }; }
    const out = stackV(mats) as CellMat;
    withMatrixUnit(out, sharedMatrixUnit(mats));
    this.cachedResult = out;
    return { result: out };
  }
}

// ─── WRAPROWS / WRAPCOLS / TOCOL / TOROW ──────────────────────────────────────

export type TableReshapeOp = "wraprows" | "wrapcols" | "tocol" | "torow";

export const TABLE_RESHAPE_OP_META = {
  wraprows: { label: "WRAPROWS", description: "Wraps a list into a table row-by-row. Each row has Wrap_count values. Excel: WRAPROWS." },
  wrapcols: { label: "WRAPCOLS", description: "Wraps a list into a table column-by-column. Each column has Wrap_count values. Excel: WRAPCOLS." },
  tocol:    { label: "TOCOL",    description: "Flatten a table to a 1D list, reading row by row. Excel: TOCOL." },
  torow:    { label: "TOROW",    description: "Flatten a table to a 1D list, reading column by column. Excel: TOROW." },
} satisfies Record<TableReshapeOp, { label: string; description: string }>;

export class TableReshapeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    fill: "Pads the leftover cells. Unwired or blank pads with #N/A, like Excel's default.",
  };

  /** Keeps `UnitCell` tags on its LIST input — WRAPROWS/WRAPCOLS convert a
   *  uniform-unit list into a whole-grid matrix unit itself. */
  unitAware = true;
  label: string;
  op: TableReshapeOp;
  cachedList: Cell[] | null = null;
  cachedMatrix: CellMat | null = null;
  literals: Record<string, number> = { wrapCount: 3 };
  width = 180; height = 200;

  /** Element-preserving, rank-CROSSING: the output adopts the input's element FAMILY
   *  at its own declared rank (the projectTypeToBase half of output adoption). */
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
    if (wraps) {
      this.addInput("list",      anyListIn("List"));
      this.addInput("wrapCount", numIn("Wrap count"));
      this.addInput("fill",      anyIn("Fill"));
      this.addOutput("result", adoptiveTableOut("Table"));
      this.height = 235;
    } else {
      this.addInput("matrix", anyTableIn("Matrix"));
      this.addOutput("result", adoptiveListOut("List"));
    }
  }

  data(inputs: { list?: unknown[]; wrapCount?: number[]; fill?: unknown[]; matrix?: unknown[] }) {
    this.cachedList = null;
    this.cachedMatrix = null;
    // Leftover cells pad with the wired Fill; an unwired or blank Fill keeps Excel's
    // default #N/A pad_with — the same rule as the formula surface's wrapPad, so the
    // node and =WRAPROWS/=WRAPCOLS produce identical grids.
    if (this.op === "wraprows") {
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const wRaw = readInput(inputs.wrapCount, this.literals.wrapCount ?? 3);
      const w = wRaw === null ? 0 : Math.round(wRaw);
      if (!raw || w < 1) return { result: null };
      const { mags: list, unit } = matrixCellsFromList(raw);
      const pad = wrapPadCell(inputs.fill, "row");
      const rows: CellMat = wrapCells(list as Cell[], w, "rows", () => pad);
      withMatrixUnit(rows, unit);
      this.cachedMatrix = rows;
      return { result: rows };
    } else if (this.op === "wrapcols") {
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const wRaw = readInput(inputs.wrapCount, this.literals.wrapCount ?? 3);
      const w = wRaw === null ? 0 : Math.round(wRaw);
      if (!raw || w < 1) return { result: null };
      const { mags: list, unit } = matrixCellsFromList(raw);
      const pad = wrapPadCell(inputs.fill, "column");
      const mat: CellMat = wrapCells(list as Cell[], w, "cols", () => pad);
      withMatrixUnit(mat, unit);
      this.cachedMatrix = mat;
      return { result: mat };
    } else if (this.op === "tocol") {
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
  chooserows: { label: "CHOOSEROWS", description: "Selects rows from a table by 1-based index list. Excel: CHOOSEROWS." },
  choosecols: { label: "CHOOSECOLS", description: "Selects columns from a table by 1-based index list. Excel: CHOOSECOLS." },
} satisfies Record<TableSelectOp, { label: string; description: string }>;

export class TableSelectNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    indices: "Negative indices count from the end. A zero or out-of-range index errors the whole result.",
  };

  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  op: TableSelectOp;
  cachedResult: CellMat | SolError | null = null;
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: TableSelectOp }) {
    super("TableSelect");
    this.op    = init?.op    ?? "chooserows";
    this.label = init?.label ?? TABLE_SELECT_OP_META[this.op].label;
    this.addInput("matrix",  adoptiveTableIn("Matrix"));
    this.addInput("indices", listIn(this.op === "chooserows" ? "Row indices (1-based)" : "Col indices (1-based)"));
    this.addOutput("result", adoptiveTableOut("Result"));
  }

  data(inputs: { matrix?: unknown[]; indices?: number[][] }): { result: CellMat | SolError | null } {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    const idx = inputs.indices?.[0] ?? null;
    if (!m || !idx) { this.cachedResult = null; return { result: null }; }
    const picked = chooseAxis(m, idx, this.op === "chooserows" ? "row" : "column");
    this.cachedResult = isSolError(picked) ? picked : carryMatrixUnit(picked, m);
    return { result: this.cachedResult };
  }
}

// ─── TAKE / DROP (rank-preserving: list, matrix or scalar) ────────────────────
// One card for what were the 1-D and 2-D spellings. The op is TAKE or DROP; the
// DIRECTION is the SIGN of the count (Excel's convention). 0 (the default) stands
// in for Excel's omitted argument: "all" for TAKE, "none" for DROP. The result is
// the SAME rank as the input, through the ONE takeSlice/dropSlice kernel the
// TAKE/DROP formulas run (shareImpl) — those formulas are the oracle.

export type TakeDropOp = "take" | "drop";

export const TAKEDROP_OP_META = {
  take: { label: "TAKE", description: "Keeps elements, rows or columns from the edges of a list or table: positive counts from the start, negative from the end, 0 keeps all. Excel: TAKE." },
  drop: { label: "DROP", description: "Removes elements, rows or columns from the edges of a list or table: positive counts from the start, negative from the end, 0 removes none. Excel: DROP." },
} satisfies Record<TakeDropOp, { label: string; description: string }>;

export class TakeDropNode extends ClassicPreset.Node {
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["data"], combine: "single" }];
  label: string;
  op: TakeDropOp;
  cachedResult: unknown = null;
  literals: Record<string, number> = { rows: 0, cols: 0 };
  width = 190; height = 250;

  constructor(init?: { label?: string; op?: TakeDropOp }) {
    super("TakeDrop");
    this.op    = init?.op    ?? "take";
    this.label = init?.label ?? TAKEDROP_OP_META[this.op].label;
    // Labels stay op-neutral: the op swaps at runtime, sockets are fixed here.
    this.addInput("data", anyDataIn("List or table"));
    this.addInput("rows", numIn("Count (± from end)"));
    this.addInput("cols", numIn("Cols (± from end)"));
    this.addOutput("result", adoptiveDataOut("Result"));
  }

  // 0 = identity for both ops ("take all" / "drop none", Excel's omitted arg).
  private slice<T>(arr: readonly T[], n: number): T[] {
    return this.op === "take" ? takeSlice(arr, n) : dropSlice(arr, n);
  }

  data(inputs: { data?: unknown[]; rows?: number[]; cols?: number[] }): { result: unknown } {
    const raw = inputs.data?.[0];
    if (raw == null) { this.cachedResult = null; return { result: null }; }
    const rRaw = readInput(inputs.rows, this.literals.rows ?? 0);
    const cRaw = readInput(inputs.cols, this.literals.cols ?? 0);
    if (rRaw === null || cRaw === null) { this.cachedResult = null; return { result: null }; }
    const nRows = Math.round(rRaw);
    const nCols = Math.round(cRaw);
    // MATRIX: a genuine 2-D array — cut both axes, carry the grid's unit.
    if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      const m = raw as CellMat;
      const result = carryMatrixUnit(this.slice(m, nRows).map((r) => [...this.slice(r, nCols)]), m);
      this.cachedResult = result;
      return { result };
    }
    // LIST or SCALAR: a scalar wraps to a 1-element list (mirrors the formula's
    // toList). A cols argument has no meaning on rank ≤ 1 — #SHAPE!, the same text
    // the formula raises.
    if (nCols !== 0) {
      const err = solError("#SHAPE!", `${this.op === "take" ? "TAKE" : "DROP"} of a list has no columns — pass one count`);
      this.cachedResult = err;
      return { result: err };
    }
    const arr = Array.isArray(raw) ? (raw as unknown[]) : [raw];
    const result = this.slice(arr, nRows);
    this.cachedResult = result;
    return { result };
  }
}

// ─── EXPAND (grow a table, padding new cells) ─────────────────────────────────
// Shrinking is #VALUE! like Excel — TAKE is the shrinker.

export class ExpandNode extends ClassicPreset.Node {
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
    const reqRRaw = readInput(inputs.rows, this.literals.rows ?? 0);
    const reqCRaw = readInput(inputs.cols, this.literals.cols ?? 0);
    if (reqRRaw === null || reqCRaw === null) { this.cachedResult = null; return { result: null }; }
    // Unwired Fill pads with `null`, NOT Excel's #N/A (wire the NA node for that) —
    // the author's deliberate override (value-semantics.md).
    const fill = (inputs.fill?.[0] ?? null) as Cell;
    const result = expandMat(m, Math.round(reqRRaw), Math.round(reqCRaw), fill);
    this.cachedResult = isSolError(result) ? result : (carryMatrixUnit(result, m), result);
    return { result: this.cachedResult };
  }
}

// ─── SET CELL (overwrite cells of a table by address) ─────────────────────────

export class SetCellNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    row: "1-based.",
    col: "1-based.",
  };
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  cachedResult: CellMat | SolError | null = null;
  // Row/Column are numeric addresses; the Value slot's literal is a number OR text, so it
  // needs both maps (autoLiterals). One row on a fresh card.
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  autoLiterals = true;
  nextPairId = 0;
  readonly pairLabels: string[] = ["Value", "Row", "Column"];
  width = 210; height = 300;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("SetCell");
    this.label = init?.label ?? "Set Cell";
    this.addInput("matrix", adoptiveTableIn("Table"));
    const ids = pairIdsFromKeys(init?.valueKeys, "value");
    if (ids.length) {
      for (const id of ids) this.addTupleWithId(id);
    } else {
      this.addValuePair();
      this.literals = { row0: 1, col0: 1 };
    }
    this.addOutput("result", adoptiveTableOut("Result"));
  }

  private addTupleWithId(id: number): void {
    // anydata (rank ≤ 2): a scalar fills the anchor cell, a list writes a row, a matrix a block.
    this.addInput(`value${id}`, anyDataIn(`Value ${id + 1}`));
    this.addInput(`row${id}`, numIn(`Row ${id + 1}`));
    this.addInput(`col${id}`, numIn(`Column ${id + 1}`));
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

  /** Ordered (valueKey, rowKey, colKey) triplets currently present, in insertion order. */
  valuePairKeys(): string[][] {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("value"))
      .map((k) => { const id = k.slice(5); return [`value${id}`, `row${id}`, `col${id}`]; });
  }

  addValuePair(): void {
    this.addTupleWithId(this.nextPairId);
  }

  removeValuePair(valueKey: string): void {
    const id = valueKey.slice(5);
    for (const k of [`value${id}`, `row${id}`, `col${id}`]) {
      this.removeInput(k);
      delete this.literals[k];
      delete this.stringLiterals[k];
    }
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    if (!m || m.length === 0) { this.cachedResult = null; return { result: null }; }
    const writes: { r: number; c: number; v: Cell | Cell[] | Cell[][] }[] = [];
    for (const [valueKey, rowKey, colKey] of this.valuePairKeys()) {
      // Row / Column are ADDRESSES: a wired-blank or unset one makes the whole result null.
      const r = readInput(inputs[rowKey], this.literals[rowKey] ?? null);
      const c = readInput(inputs[colKey], this.literals[colKey] ?? null);
      if (r === null || c === null) { this.cachedResult = null; return { result: null }; }
      // Value is an OPERAND, extended by shape in setCells: a wired scalar/list/matrix keeps
      // its rank; a wired-blank writes one null cell; an unwired one uses the typed literal.
      const v = pickSlot(this, inputs, valueKey) as Cell | Cell[] | Cell[][];
      writes.push({ r: r as number, c: c as number, v });
    }
    const result = setCells(m, writes);
    this.cachedResult = isSolError(result) ? result : (carryMatrixUnit(result, m), result);
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
    // A `frame` input takes both: a raw matrix widens in with default headers.
    this.addInput("matrix", frameIn("Table"));
    this.addOutput("rows", numOut("ROWS"));
    this.addOutput("cols", numOut("COLUMNS"));
  }

  data(inputs: { matrix?: unknown[] }) {
    const input = inputs.matrix?.[0];
    // toAnyMatrix reads a Frame as a scalar (1×1) — report its real shape directly.
    if (isFrameValue(input)) {
      this.cachedRows = frameRowCount(input);
      this.cachedCols = input.columns.length;
      return { rows: this.cachedRows, cols: this.cachedCols };
    }
    const { rows, cols } = matrixShape(input);
    this.cachedRows = rows;
    this.cachedCols = cols;
    return { rows, cols };
  }
}

// ─── SOLVE (A·x = b) ──────────────────────────────────────────────────────────
export class MatSolveNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    matrix: "Square, every cell filled; singular is #DIV/0!.",
    b: "One value per row of A.",
  };
  label: string;
  cachedResult: number[] | SolError | null = null;
  width = 180; height = 170;

  constructor(init?: { label?: string }) {
    super("MatSolve");
    this.label = init?.label ?? "Solve A·x = b";
    this.addInput("matrix", tableIn("A"));
    this.addInput("b", numListIn("b"));
    this.addOutput("result", numListOut("x"));
  }

  data(inputs: { matrix?: CellMat[]; b?: (number | null)[][] }): { result: number[] | SolError | null } {
    const raw = inputs.matrix?.[0] ?? null, b = inputs.b?.[0] ?? null;
    if (!raw || !b) { this.cachedResult = null; return { result: null }; }
    const m = asNumericMatrix(raw);
    if (isSolError(m)) { this.cachedResult = m; return { result: m }; }
    if (b.some((v) => typeof v !== "number")) { this.cachedResult = null; return { result: null }; }
    if (matRows(m) !== matCols(m) || b.length !== matRows(m)) {
      const err = solError("#SHAPE!", "A must be square with one b per row");
      this.cachedResult = err; return { result: err };
    }
    const x = matSolve(m, b as number[]);
    const result = x ?? solError("#DIV/0!", "A is singular — the system has no unique solution");
    this.cachedResult = result;
    return { result };
  }
}

// ─── EIGEN (symmetric) ────────────────────────────────────────────────────────
export class MatEigenNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    matrix: "Square and SYMMETRIC (a covariance or correlation matrix, a Laplacian…); a non-symmetric matrix is #SHAPE!.",
    values: "Eigenvalues, largest first.",
    vectors: "Unit eigenvectors as COLUMNS, in the same order; the largest-magnitude entry of each is made positive.",
  };
  label: string;
  cachedValues: number[] | SolError | null = null;
  cachedVectors: Mat | SolError | null = null;
  width = 190; height = 175;

  constructor(init?: { label?: string }) {
    super("MatEigen");
    this.label = init?.label ?? "Eigen (symmetric)";
    this.addInput("matrix", tableIn("Matrix"));
    this.addOutput("values", numListOut("Eigenvalues"));
    this.addOutput("vectors", tableOut("Eigenvectors"));
  }

  data(inputs: { matrix?: CellMat[] }): { values: number[] | SolError | null; vectors: Mat | SolError | null } {
    const raw = inputs.matrix?.[0] ?? null;
    if (!raw) { this.cachedValues = null; this.cachedVectors = null; return { values: null, vectors: null }; }
    const m = asNumericMatrix(raw);
    if (isSolError(m)) { this.cachedValues = m; this.cachedVectors = m; return { values: m, vectors: m }; }
    const e = matEigh(m);
    if (!e) {
      const err = solError("#SHAPE!", "Eigen needs a square, symmetric matrix");
      this.cachedValues = err; this.cachedVectors = err; return { values: err, vectors: err };
    }
    this.cachedValues = e.values; this.cachedVectors = e.vectors;
    return { values: e.values, vectors: e.vectors };
  }
}
