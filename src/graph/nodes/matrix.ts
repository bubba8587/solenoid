// [[C58]], [[C48]], [[B11]]
import { ClassicPreset } from "rete";
import { matRows, matCols, matTranspose, matUnit, matDiag, outerProduct, asNumericMatrix, matMul, matDet, matInverse, matTrace, matRank, matNorm, matSolve, matEigh, wrapCount, wrapCells, stackH, stackV, chooseAxis, expandMat, setCells } from "./matrixOps";
import { takeSlice, dropSlice } from "./listOps";
import { numIn, numOut, listIn, numListOut, anyIn, anyDataIn, anyListIn, anyTableIn, adoptiveTableIn, adoptiveTableOut, adoptiveListOut, adoptiveDataOut, tableIn, tableOut, frameIn, readInput } from "./shared";
import { pickSlot, pairIdsFromKeys } from "./logic";
import type { PassthroughSpec } from "./passthrough";
import { toAnyMatrix, matrixShape, type Cell } from "./coerce";
import { tableSocket, strTableSocket, dateTableSocket, logicalTableSocket } from "../sockets";
import { parseCsvRows } from "../csv";
import { solError, isSolError, type SolError } from "../errorValue";
import { isFrameValue, frameRowCount, coerceFrameCell, type FrameValue } from "../frame";
import { isFrameRef, collectPreview } from "../frameBackend";
import { carryMatrixUnit, withMatrixUnit, matrixUnitOf, sharedMatrixUnit, isUnitCell } from "../unitValue";
import { applyFcUnit } from "../unitBridge";
import { taggedListFromMatrix, matrixCellsFromList } from "../unitColumn";

// ─── Internal helpers ─────────────────────────────────────────────────────────

type Mat = (number | null)[][]; // a null cell is missing; linear-algebra ops reject it
type CellMat = Cell[][];

// ─── TABLE INPUT ──────────────────────────────────────────────────────────────

export type TableElemType = "number" | "string" | "date" | "logical";

export const TABLE_ELEM_SOCKET = {
  number: tableSocket,
  string: strTableSocket,
  date: dateTableSocket,
  logical: logicalTableSocket,
} as const;

export function tableRawCells(text: string): string[][] {
  // keepBlankLines: the popup re-serializes through this parse, so dropping a blank line would delete that row on save.
  const raw = parseCsvRows(text, { keepBlankLines: true });
  if (raw.length === 0) return [];
  let cols = raw.reduce((m, r) => Math.max(m, r.length), 0);
  // A trailing all-empty column is a typing artifact that would turn a list into a 2-D table; interior blanks stay.
  while (cols > 1 && raw.every((r) => (r[cols - 1] ?? "").trim() === "")) cols--;
  return raw.map((r) => Array.from({ length: cols }, (_, j) => (r[j] ?? "").trim()));
}

/** Uses "," instead of ", " when any cell needs quoting, since a quoted field must start right after the comma. */
export function rawCellsToText(cells: string[][]): string {
  const needsQuote = (c: string) => /[",\n]/.test(c);
  const q = (c: string) => (needsQuote(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const sep = cells.some((r) => r.some(needsQuote)) ? "," : ", ";
  const lines = cells.map((r) => r.map(q).join(sep));
  const text = lines.join("\n");
  // A trailing blank row in one column needs its own newline, or it reads back as the terminator.
  return lines.length > 0 && lines[lines.length - 1] === "" ? text + "\n" : text;
}

export function deriveTable(cells: string[][], dt: TableElemType): CellMat {
  return cells.map((row) => row.map((c) => coerceFrameCell(dt, c) as Cell));
}

export class TableInputNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CellMat | null = null;
  tableText: string = "1, 0\n0, 1";
  dataType: TableElemType;
  /** The unit authored on this source, an FC unit id; number tables only. */
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

  rawCells(): string[][] { return tableRawCells(this.tableText); }

  /** Retypes in place and fires no connection event, so the component follows with retypeOutputCables. */
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
    // applyFcUnit tags a copy of the outer array; the cells stay bare.
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
  mdeterm:  { label: "MDETERM",  description: "Determinant of a square matrix. Excel: `MDETERM`." },
  minverse: { label: "MINVERSE", description: "Inverse of a square matrix: result × input = identity. Excel: `MINVERSE`." },
  trace:    { label: "TRACE",    description: "Sum of the main diagonal. numpy `trace`, R `sum(diag(m))`." },
  rank:     { label: "MATRIXRANK", description: "Rank: the number of linearly independent rows (Gaussian elimination with a tolerance). numpy `matrix_rank`, R `qr(m)$rank`." },
  norm:     { label: "NORM",     description: "Frobenius norm: √Σ every cell squared (`numpy.linalg.norm` default, R `norm(m, \"F\")`). Excel: `SQRT(SUMSQ(range))`." },
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
    this.label = init?.label ?? "";
    this.addInput("matrix", tableIn("Matrix"));
    this.addOutput("result", MAT_DET_SCALAR.has(this.op) ? numOut(MAT_DET_OP_META[this.op].label) : tableOut("Inverse"));
  }

  /** Retypes in place and fires no connection event, so the component follows with retypeOutputCables. */
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
    const m = asNumericMatrix(raw);
    const scalar = MAT_DET_SCALAR.has(this.op);
    if (isSolError(m)) {
      if (scalar) this.cachedScalar = m; else this.cachedMatrix = m;
      return { result: m };
    }
    if (this.op === "rank")  { const r = matRank(m);  this.cachedScalar = r; return { result: r }; }
    if (this.op === "norm")  { const r = matNorm(m);  this.cachedScalar = r; return { result: r }; }
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
    this.addInput("a", tableIn("A"));
    this.addInput("b", tableIn("B"));
    this.addOutput("result", tableOut("A × B"));
  }

  data(inputs: { a?: CellMat[]; b?: CellMat[] }): { result: Mat | SolError | null } {
    const rawA = inputs.a?.[0] ?? null, rawB = inputs.b?.[0] ?? null;
    if (!rawA || !rawB) { this.cachedResult = null; return { result: null }; }
    const a = asNumericMatrix(rawA), b = asNumericMatrix(rawB);
    if (isSolError(a)) { this.cachedResult = a; return { result: a }; }
    if (isSolError(b)) { this.cachedResult = b; return { result: b }; }
    const product = matMul(a, b);
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
  cachedResult: Mat | SolError | null = null;
  literals: Record<string, number> = { n: 3 };
  /** 0, as Excel's MUNIT, or blank, which stays out of sums, counts and element-wise combines. */
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
    const n = readInput(inputs.n, this.literals.n ?? 3);
    if (n === null) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = matUnit(n, this.offDiag === "blank" ? null : 0);
    return { result: this.cachedResult };
  }
}

// ─── DIAGONAL ───────────────────────────────────────────────────────────────
export class TableDiagNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Mat | SolError | null = null;
  offDiag: "zero" | "blank" = "zero";
  width = 180; height = 190;

  constructor(init?: { label?: string; offDiag?: "zero" | "blank" }) {
    super("TableDiag");
    this.label = init?.label ?? "DIAGONAL";
    if (init?.offDiag) this.offDiag = init.offDiag;
    this.addInput("diag", listIn("Diagonal")); // the strict list rung, so a one-item list is never collapsed to a scalar
    this.addOutput("result", tableOut("Diagonal matrix"));
  }

  data(inputs: { diag?: (number | null)[][] }) {
    const values = inputs.diag?.[0] ?? null;
    if (!values || values.length === 0) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = matDiag(values, this.offDiag === "blank" ? null : 0);
    return { result: this.cachedResult };
  }
}

// ─── OUTER ────────────────────────────────────────────────────────────────────
export class TableOuterNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Mat | SolError | null = null;
  width = 180; height = 200;

  constructor(init?: { label?: string }) {
    super("TableOuter");
    this.label = init?.label ?? "OUTER";
    this.addInput("a", listIn("A")); // the strict list rung re-widens a scalar
    this.addInput("b", listIn("B"));
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
    this.cachedResult = m ? carryMatrixUnit(matTranspose(m), m) : null;
    return { result: this.cachedResult };
  }
}

// ─── HSTACK / VSTACK — the 2-D rungs of the append ladder ([[C48]] appendLadder) ───────────────

function wrapPadCell(fill: unknown[] | undefined, what: string): Cell {
  const v = (fill?.[0] ?? null) as Cell;
  return v != null ? v : solError("#N/A", `Padded: the list doesn't fill the last ${what}`);
}

/** A matrix carries one whole-grid unit tag, never per-cell UnitCells, so reduce a widened list row to bare magnitudes plus their shared unit. */
function demoteUnitCells(m: CellMat): CellMat {
  if (!m.some((row) => row.some(isUnitCell))) return m;
  const { mags, unit } = matrixCellsFromList(m.flat());
  const bare: CellMat = [];
  let i = 0;
  for (const row of m) { bare.push(mags.slice(i, i + row.length) as Cell[]); i += row.length; }
  return withMatrixUnit(bare, unit);
}

export type StackOp = "vstack" | "hstack";

export const STACK_OP_META = {
  vstack: { label: "VSTACK", description: "Stacks tables top-to-bottom, in row order. A list counts as one row, so two lists make a 2-row table. A narrower table pads right with `#N/A`. Excel: `VSTACK`." },
  hstack: { label: "HSTACK", description: "Concatenates tables side by side. A list counts as one row, so two lists make one long row. A shorter table pads down with `#N/A`. Excel: `HSTACK`." },
} satisfies Record<StackOp, { label: string; description: string }>;

export class StackNode extends ClassicPreset.Node {
  /** Receives UnitCell tags so demoteUnitCells can lift a dimensioned list row to a grid unit. */
  unitAware = true;
  label: string;
  op: StackOp;
  cachedResult: CellMat | SolError | null = null;
  nextInputId = 0;
  width = 180; height = 250;

  constructor(init?: { label?: string; op?: StackOp; valueKeys?: string[] }) {
    super("Stack");
    this.op = init?.op ?? "vstack";
    this.label = init?.label ?? "";
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("t"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("result", adoptiveTableOut("Stacked"));
  }

  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: this.valueInputKeys(), combine: "agree" }];

  private addInputWithKey(key: string): void {
    this.addInput(key, anyTableIn("Table"));
    const n = parseInt(key.replace(/^t/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Insertion order is stack order. */
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

  private matsOf(inputs: Record<string, unknown[] | undefined>): CellMat[] {
    return this.valueInputKeys()
      .map((k) => toAnyMatrix(inputs[k]?.[0]))
      .filter((m): m is CellMat => !!m && m.length > 0)
      .map(demoteUnitCells);
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    const mats = this.matsOf(inputs);
    if (mats.length === 0) { this.cachedResult = null; return { result: null }; }
    const out = (this.op === "vstack" ? stackV(mats) : stackH(mats)) as CellMat;
    withMatrixUnit(out, sharedMatrixUnit(mats));
    this.cachedResult = out;
    return { result: out };
  }
}

// ─── WRAPROWS / WRAPCOLS / TOCOL / TOROW ──────────────────────────────────────

export type TableReshapeOp = "wraprows" | "wrapcols" | "tocol" | "torow";

export const TABLE_RESHAPE_OP_META = {
  wraprows: { label: "WRAPROWS", description: "Wraps a list into a table row-by-row. Each row has `Wrap_count` values. Excel: `WRAPROWS`." },
  wrapcols: { label: "WRAPCOLS", description: "Wraps a list into a table column-by-column. Each column has `Wrap_count` values. Excel: `WRAPCOLS`." },
  tocol:    { label: "TOCOL",    description: "Flatten a table to a 1D list, reading row by row. Excel: `TOCOL`." },
  torow:    { label: "TOROW",    description: "Flatten a table to a 1D list, reading column by column. Excel: `TOROW`." },
} satisfies Record<TableReshapeOp, { label: string; description: string }>;

export class TableReshapeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    fill: "Pads the leftover cells. Unwired or blank pads with #N/A, like Excel's default.",
  };

  /** Receives UnitCell tags on its list input: WRAPROWS and WRAPCOLS turn a one-unit list into a grid unit themselves. */
  unitAware = true;
  label: string;
  op: TableReshapeOp;
  cachedList: Cell[] | null = null;
  cachedMatrix: CellMat | null = null;
  literals: Record<string, number> = { wrapCount: 3 };
  width = 180; height = 200;

  passthrough = (): PassthroughSpec[] => [{
    output: "result",
    inputs: [this.op === "wraprows" || this.op === "wrapcols" ? "list" : "matrix"],
    combine: "single",
  }];

  constructor(init?: { label?: string; op?: TableReshapeOp }) {
    super("TableReshape");
    this.op    = init?.op    ?? "wraprows";
    this.label = init?.label ?? "";
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
    // Pads with the wired Fill, or Excel's #N/A when Fill is unwired or blank, the same rule as the formula surface's wrapPad.
    if (this.op === "wraprows") {
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const wRaw = readInput(inputs.wrapCount, this.literals.wrapCount ?? 3);
      if (!raw || wRaw === null) return { result: null };
      const w = wrapCount(wRaw, "WRAPROWS");
      if (isSolError(w)) return { result: w };
      const { mags: list, unit } = matrixCellsFromList(raw);
      const pad = wrapPadCell(inputs.fill, "row");
      const rows: CellMat = wrapCells(list as Cell[], w, "rows", () => pad);
      withMatrixUnit(rows, unit);
      this.cachedMatrix = rows;
      return { result: rows };
    } else if (this.op === "wrapcols") {
      const raw = toAnyMatrix(inputs.list?.[0])?.flat() ?? null;
      const wRaw = readInput(inputs.wrapCount, this.literals.wrapCount ?? 3);
      if (!raw || wRaw === null) return { result: null };
      const w = wrapCount(wRaw, "WRAPCOLS");
      if (isSolError(w)) return { result: w };
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
  chooserows: { label: "CHOOSEROWS", description: "Selects rows from a table by 1-based index list. Excel: `CHOOSEROWS`." },
  choosecols: { label: "CHOOSECOLS", description: "Selects columns from a table by 1-based index list. Excel: `CHOOSECOLS`." },
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
    this.label = init?.label ?? "";
    this.addInput("matrix",  adoptiveTableIn("Table"));
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

// ─── TAKE / DROP ───────────────────────────────────────────────────────────────

export type TakeDropOp = "take" | "drop";

export const TAKEDROP_OP_META = {
  take: { label: "TAKE", description: "Keeps elements, rows or columns from the edges of a list or table: positive counts from the start, negative from the end, `0` keeps all. Excel: `TAKE`." },
  drop: { label: "DROP", description: "Removes elements, rows or columns from the edges of a list or table: positive counts from the start, negative from the end, `0` removes none. Excel: `DROP`." },
} satisfies Record<TakeDropOp, { label: string; description: string }>;

export class TakeDropNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rows: "Positive counts from the start, negative from the end, 0 keeps all.",
    cols: "Positive counts from the start, negative from the end, 0 keeps all.",
  };
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["data"], combine: "single" }];
  label: string;
  op: TakeDropOp;
  cachedResult: unknown = null;
  literals: Record<string, number> = { rows: 0, cols: 0 };
  width = 190; height = 250;

  constructor(init?: { label?: string; op?: TakeDropOp }) {
    super("TakeDrop");
    this.op    = init?.op    ?? "take";
    this.label = init?.label ?? "";
    // Labels stay op-neutral: the op swaps at runtime, and the sockets are fixed here.
    this.addInput("data", anyDataIn("List or table"));
    this.addInput("rows", numIn("Count"));
    this.addInput("cols", numIn("Cols"));
    this.addOutput("result", adoptiveDataOut("Result"));
  }

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
    const gone = (len: number, k: number) => this.op === "drop" && len > 0 && Math.abs(k) >= len;
    if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      const m = raw as CellMat;
      if (gone(m.length, nRows) || gone(m[0].length, nCols)) {
        const err = solError("#DOMAIN!", "DROP would leave nothing (Excel: #CALC!)");
        this.cachedResult = err;
        return { result: err };
      }
      const result = carryMatrixUnit(this.slice(m, nRows).map((r) => [...this.slice(r, nCols)]), m);
      this.cachedResult = result;
      return { result };
    }
    // A scalar wraps to a one-item list and a cols count is #SHAPE!, both as the formula does.
    if (nCols !== 0) {
      const err = solError("#SHAPE!", `${this.op === "take" ? "TAKE" : "DROP"} of a list has no columns — pass one count`);
      this.cachedResult = err;
      return { result: err };
    }
    const arr = Array.isArray(raw) ? (raw as unknown[]) : [raw];
    if (gone(arr.length, nRows)) {
      const err = solError("#DOMAIN!", "DROP would leave nothing (Excel: #CALC!)");
      this.cachedResult = err;
      return { result: err };
    }
    const result = this.slice(arr, nRows);
    this.cachedResult = result;
    return { result };
  }
}

// ─── EXPAND ───────────────────────────────────────────────────────────────────

export class ExpandNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    rows: "Target row count. 0 keeps the current count.",
    cols: "Target column count. 0 keeps the current count.",
  };
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  cachedResult: CellMat | SolError | null = null;
  literals: Record<string, number> = { rows: 0, cols: 0 };
  width = 190; height = 260;

  constructor(init?: { label?: string }) {
    super("Expand");
    this.label = init?.label ?? "EXPAND";
    this.addInput("matrix", adoptiveTableIn("Table"));
    this.addInput("rows",   numIn("Rows"));
    this.addInput("cols",   numIn("Cols"));
    this.addInput("fill",   anyIn("Fill"));
    this.addOutput("result", adoptiveTableOut("Expanded"));
  }

  data(inputs: { matrix?: unknown[]; rows?: number[]; cols?: number[]; fill?: unknown[] }): { result: CellMat | SolError | null } {
    const m = toAnyMatrix(inputs.matrix?.[0]);
    if (!m || m.length === 0) { this.cachedResult = null; return { result: null }; }
    const reqRRaw = readInput(inputs.rows, this.literals.rows ?? 0);
    const reqCRaw = readInput(inputs.cols, this.literals.cols ?? 0);
    if (reqRRaw === null || reqCRaw === null) { this.cachedResult = null; return { result: null }; }
    const fill = (inputs.fill?.[0] ?? null) as Cell;
    const result = expandMat(m, Math.round(reqRRaw), Math.round(reqCRaw), fill);
    this.cachedResult = isSolError(result) ? result : (carryMatrixUnit(result, m), result);
    return { result: this.cachedResult };
  }
}

// ─── SET CELL ─────────────────────────────────────────────────────────────────

export class SetCellNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    row: "1-based.",
    col: "1-based.",
  };
  passthrough = (): PassthroughSpec[] => [{ output: "result", inputs: ["matrix"], combine: "single" }];
  label: string;
  cachedResult: CellMat | SolError | null = null;
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
    this.addInput(`value${id}`, anyDataIn(`Value ${id + 1}`));
    this.addInput(`row${id}`, numIn(`Row ${id + 1}`));
    this.addInput(`col${id}`, numIn(`Column ${id + 1}`));
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

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
      const r = readInput(inputs[rowKey], this.literals[rowKey] ?? null);
      const c = readInput(inputs[colKey], this.literals[colKey] ?? null);
      if (r === null || c === null) { this.cachedResult = null; return { result: null }; }
      const v = pickSlot(this, inputs, valueKey) as Cell | Cell[] | Cell[][];
      writes.push({ r: r as number, c: c as number, v });
    }
    const result = setCells(m, writes);
    this.cachedResult = isSolError(result) ? result : (carryMatrixUnit(result, m), result);
    return { result: this.cachedResult };
  }
}

// ─── ROWS / COLUMNS ───────────────────────────────────────────────────────────

export class TableInfoNode extends ClassicPreset.Node {
  label: string;
  cachedRows: number | null = null;
  cachedCols: number | null = null;
  width = 200; height = 200;

  constructor(init?: { label?: string }) {
    super("TableInfo");
    this.label = init?.label ?? "Table Size";
    this.addInput("matrix", frameIn("Table"));
    this.addOutput("rows", numOut("ROWS"));
    this.addOutput("cols", numOut("COLUMNS"));
  }

  data(inputs: { matrix?: unknown[] }) {
    const input = inputs.matrix?.[0];
    const ofFrame = (f: FrameValue) => {
      this.cachedRows = f.__totalRows ?? frameRowCount(f);
      this.cachedCols = f.columns.length;
      return { rows: this.cachedRows, cols: this.cachedCols };
    };
    if (isFrameRef(input)) {
      return (async () => {
        const p = await collectPreview(input, 0);
        if (!isFrameValue(p)) { this.cachedRows = null; this.cachedCols = null; return { rows: p, cols: p }; }
        return ofFrame(p);
      })() as unknown as { rows: number | null; cols: number | null };
    }
    // toAnyMatrix reads a Frame as 1×1, so report its real shape here.
    if (isFrameValue(input)) return ofFrame(input);
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
    this.addInput("b", listIn("b"));
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
    const result = x ?? solError("#DIV/0!", "A is singular, so the system has no unique solution");
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
