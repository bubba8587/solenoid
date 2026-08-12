import { ClassicPreset } from "rete";
import { matRows, matCols, matTranspose, matUnit, asNumericMatrix, matMul, matDet, matInverse, wrapCells } from "./matrixOps";
import { takeSlice, dropSlice } from "./listOps";
import { numIn, numOut, listIn, anyIn, anyListIn, anyTableIn, adoptiveTableIn, adoptiveTableOut, adoptiveListOut, tableIn, tableOut, frameIn, readInput } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { toAnyMatrix, type Cell } from "./coerce";
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
  /** The homogeneous unit AUTHORED on this literal source (D20) — an FC unit id;
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
    // Non-square is a dimension problem (#SHAPE!); a rejected square one is singular.
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
    // A blank size means an unknown grid, not a default 3×3.
    const n = readInput(inputs.n, this.literals.n ?? 3);
    if (n === null) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = matUnit(n, this.offDiag === "blank" ? null : 0);
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
    // A structural reshape preserves the homogeneous matrix unit (D20) — carry the
    // tag onto the fresh output array.
    this.cachedResult = m ? carryMatrixUnit(matTranspose(m), m) : null;
    return { result: this.cachedResult };
  }
}

// ─── HSTACK / VSTACK — the 2-D rungs of the append ladder (D15) ───────────────
// Ragged inputs pad with #N/A cells (recoverable via IFNA/Fill) rather than failing
// the whole result with #SHAPE!.

/** One #N/A pad cell per data() pass (SolErrors are immutable — sharing is fine). */
function padCell(what: string): Cell {
  return solError("#N/A", `Padded: this input is ${what} than the largest one`);
}

/** A matrix carries ONE whole-grid unit tag, never per-cell `UnitCell`s (D20): reduce
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
   *  dimensioned LIST row to a grid unit — tags riding INTO the matrix break D20. */
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
   *  D20 matrix shape on the way in. */
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
    const height = Math.max(...mats.map(matRows));
    const na = padCell("shorter");
    const out: CellMat = Array.from({ length: height }, () => []);
    for (const m of mats) {
      const w = matCols(m);
      for (let i = 0; i < height; i++) {
        out[i].push(...(i < m.length ? m[i] : Array<Cell>(w).fill(na)));
      }
    }
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
    const width = Math.max(...mats.map(matCols));
    const na = padCell("narrower");
    const out: CellMat = [];
    for (const m of mats) {
      for (const r of m) {
        out.push(r.length < width ? [...r, ...Array<Cell>(width - r.length).fill(na)] : [...r]);
      }
    }
    withMatrixUnit(out, sharedMatrixUnit(mats));
    this.cachedResult = out;
    return { result: out };
  }
}

// ─── WRAPROWS / WRAPCOLS / TOCOL / TOROW ──────────────────────────────────────

export type TableReshapeOp = "wraprows" | "wrapcols" | "tocol" | "torow";

export const TABLE_RESHAPE_OP_META = {
  wraprows: { label: "WRAPROWS", description: "Wraps a list into a table row-by-row; each row has Wrap_count values. Excel: WRAPROWS." },
  wrapcols: { label: "WRAPCOLS", description: "Wraps a list into a table column-by-column; each column has Wrap_count values. Excel: WRAPCOLS." },
  tocol:    { label: "TOCOL",    description: "Flatten a table to a 1D list, reading row by row. Excel: TOCOL." },
  torow:    { label: "TOROW",    description: "Flatten a table to a 1D list, reading column by column. Excel: TOROW." },
} satisfies Record<TableReshapeOp, { label: string; description: string }>;

export class TableReshapeNode extends ClassicPreset.Node {
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
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const wRaw = readInput(inputs.wrapCount, this.literals.wrapCount ?? 3);
      const w = wRaw === null ? 0 : Math.round(wRaw);
      if (!raw || w < 1) return { result: null };
      const { mags: list, unit } = matrixCellsFromList(raw);
      const na: Cell = solError("#N/A", "Padded: the list doesn't fill the last row");
      const rows: CellMat = wrapCells(list as Cell[], w, "rows", () => na);
      withMatrixUnit(rows, unit);
      this.cachedMatrix = rows;
      return { result: rows };
    } else if (this.op === "wrapcols") {
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const wRaw = readInput(inputs.wrapCount, this.literals.wrapCount ?? 3);
      const w = wRaw === null ? 0 : Math.round(wRaw);
      if (!raw || w < 1) return { result: null };
      const { mags: list, unit } = matrixCellsFromList(raw);
      const na: Cell = solError("#N/A", "Padded: the list doesn't fill the last column");
      const mat: CellMat = wrapCells(list as Cell[], w, "cols", () => na);
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
    // Excel edge convention: 1-based (negative counts from the end), fractional
    // truncates toward zero, any zero/out-of-range index errors the whole call.
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
// 0 (the default) stands in for Excel's omitted argument: "all" for TAKE, "none"
// for DROP. The 1-D spellings live in list.ts.

export type TableTakeDropOp = "take" | "drop";

export const TABLE_TAKEDROP_OP_META = {
  take: { label: "TAKE (table)", description: "Keeps rows/columns from a table's edges: positive counts take from the start, negative from the end, 0 takes all. A bare list counts as ONE ROW — use Cols to take its elements. Excel: TAKE(array, rows, [cols])." },
  drop: { label: "DROP (table)", description: "Removes rows/columns from a table's edges: positive counts drop from the start, negative from the end, 0 drops none. Excel: DROP(array, rows, [cols])." },
} satisfies Record<TableTakeDropOp, { label: string; description: string }>;

export class TableTakeDropNode extends ClassicPreset.Node {
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
    // Labels stay op-neutral: the op swaps at runtime, sockets are fixed here.
    this.addInput("matrix", adoptiveTableIn("Table"));
    this.addInput("rows",   numIn("Rows (± from end)"));
    this.addInput("cols",   numIn("Cols (± from end)"));
    this.addOutput("result", adoptiveTableOut("Result"));
  }

  // 0 = identity for both ops ("take all" / "drop none", Excel's omitted arg).
  private takeDrop<T>(arr: T[], n: number): T[] {
    return this.op === "take" ? takeSlice(arr, n) : dropSlice(arr, n);
  }

  data(inputs: { matrix?: unknown[]; rows?: number[]; cols?: number[] }) {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    if (!m || m.length === 0) { this.cachedResult = null; return { result: null }; }
    const rRaw = readInput(inputs.rows, this.literals.rows ?? 0);
    const cRaw = readInput(inputs.cols, this.literals.cols ?? 0);
    if (rRaw === null || cRaw === null) { this.cachedResult = null; return { result: null }; }
    const nRows = Math.round(rRaw);
    const nCols = Math.round(cRaw);
    const result = carryMatrixUnit(this.takeDrop(m, nRows).map((r) => [...this.takeDrop(r, nCols)]), m);
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
    const curR = matRows(m), curC = matCols(m);
    const reqRRaw = readInput(inputs.rows, this.literals.rows ?? 0);
    const reqCRaw = readInput(inputs.cols, this.literals.cols ?? 0);
    if (reqRRaw === null || reqCRaw === null) { this.cachedResult = null; return { result: null }; }
    const reqR = Math.round(reqRRaw);
    const reqC = Math.round(reqCRaw);
    const R = reqR > 0 ? reqR : curR;
    const C = reqC > 0 ? reqC : curC;
    if (R < curR || C < curC) {
      const e = solError("#VALUE!", `EXPAND can only grow: the table is ${curR}×${curC}, the target ${R}×${C}. Use TAKE to shrink`);
      this.cachedResult = e;
      return { result: e };
    }
    // Unwired Fill pads with `null`, NOT Excel's #N/A (wire the NA node for that).
    const fill = (inputs.fill?.[0] ?? null) as Cell;
    const result: CellMat = [];
    for (let i = 0; i < R; i++) {
      const src = i < curR ? m[i] : [];
      const row: Cell[] = [];
      for (let j = 0; j < C; j++) row.push(j < src.length ? src[j] : fill);
      result.push(row);
    }
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
    const m = toAnyMatrix(input);
    this.cachedRows = m ? matRows(m) : null;
    this.cachedCols = m ? matCols(m) : null;
    return { rows: this.cachedRows, cols: this.cachedCols };
  }
}
