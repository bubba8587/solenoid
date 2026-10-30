// [[C58]] tableInputRawText, [[C48]], [[B11]]
import { GraphNode, GraphOutput } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { SKIP_BY_CODE, type SkipCells } from "./matrixOps";
import { numIn, numOut, listIn, numListOut, anyIn, anyDataIn, anyListIn, anyTableIn, adoptiveTableIn, adoptiveTableOut, adoptiveListOut, adoptiveDataOut, tableIn, tableOut, frameIn } from "./shared";
import { rolesFrom } from "../inputRoles";
import { pairIdsFromKeys } from "./logic";
import type { PassthroughSpec } from "./passthrough";
import type { Cell } from "./coerce";
import { tableSocket, strTableSocket, dateTableSocket, logicalTableSocket } from "../sockets";
import { parseCsvRows } from "../csv";
import type { SolError } from "../errorValue";
import { isFrameValue, frameRowCount, type FrameValue } from "../frame";
import { isFrameRef, collectPreview, materialize } from "../frameBackend";

// ─── Internal helpers ─────────────────────────────────────────────────────────

type Mat = (number | null)[][]; // a null cell is missing; linear-algebra ops reject it
type CellMat = Cell[][];

// ─── TABLE INPUT ──────────────────────────────────────────────────────────────

export type TableElemType = "number" | "string" | "date" | "logical";

const TABLE_ELEM_SOCKET = {
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

export class TableInputNode extends GraphNode {
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
    this.addOutput("table", new GraphOutput(TABLE_ELEM_SOCKET[this.dataType], "Table"));
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

  data(inputs: Record<string, unknown[] | undefined> = {}) {
    return nodeOnCore(this, inputs) as { table: CellMat | null };
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

export class MatDetNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number | Mat | SolError | null };
  }
}

// ─── MMULT ────────────────────────────────────────────────────────────────────

export class TableMultNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Mat | SolError | null };
  }
}

// ─── MUNIT ────────────────────────────────────────────────────────────────────

export class TableUnitNode extends GraphNode {
  static inputRoles = rolesFrom("MUNIT", { n: 0 });
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Mat | SolError | null };
  }
}

// ─── DIAGONAL ───────────────────────────────────────────────────────────────
export class TableDiagNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Mat | SolError | null };
  }
}

// ─── OUTER ────────────────────────────────────────────────────────────────────
export class TableOuterNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Mat | SolError | null };
  }
}

// ─── TRANSPOSE ────────────────────────────────────────────────────────────────

export class TableTransposeNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: CellMat | SolError | null };
  }
}

// ─── HSTACK / VSTACK — the 2-D rungs of the append ladder ([[C48]] appendLadder) ───────────────

export type StackOp = "vstack" | "hstack";

export const STACK_OP_META = {
  vstack: { label: "VSTACK", description: "Stacks tables top-to-bottom, in row order. A list counts as one row, so two lists make a 2-row table. A narrower table pads right with `#N/A`. Excel: `VSTACK`." },
  hstack: { label: "HSTACK", description: "Concatenates tables side by side. A list counts as one row, so two lists make one long row. A shorter table pads down with `#N/A`. Excel: `HSTACK`." },
} satisfies Record<StackOp, { label: string; description: string }>;

export class StackNode extends GraphNode {
  /** Receives UnitCell tags, so a dimensioned list row lifts to a grid unit. */
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

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    return nodeOnCore(this, inputs) as { result: CellMat | SolError | null };
  }
}

// ─── WRAPROWS / WRAPCOLS / TOCOL / TOROW ──────────────────────────────────────

export type TableReshapeOp = "wraprows" | "wrapcols" | "tocol" | "torow";

export const TABLE_RESHAPE_OP_META = {
  wraprows: { label: "WRAPROWS", description: "Wraps a list into a table row-by-row. Each row has `Wrap_count` values. Excel: `WRAPROWS`." },
  wrapcols: { label: "WRAPCOLS", description: "Wraps a list into a table column-by-column. Each column has `Wrap_count` values. Excel: `WRAPCOLS`." },
  tocol:    { label: "TOCOL",    description: "Stacks a table's values into one column, reading row by row. Excel: `TOCOL`." },
  torow:    { label: "TOROW",    description: "Lines a table's values up in one list, reading row by row. Excel: `TOROW`." },
} satisfies Record<TableReshapeOp, { label: string; description: string }>;

export class TableReshapeNode extends GraphNode {
  static inputRoles = rolesFrom("WRAPROWS", { wrapCount: 1 });
  static socketDocs: Record<string, string> = {
    fill: "Pads the leftover cells. Unwired or blank pads with #N/A, like Excel's default.",
  };

  /** Receives UnitCell tags on its list input: WRAPROWS and WRAPCOLS turn a one-unit list into a grid unit themselves. */
  unitAware = true;
  label: string;
  op: TableReshapeOp;
  /** TOCOL and TOROW's `scan_by_column` and `ignore` arguments. */
  scanBy: "row" | "col";
  skipCells: SkipCells;
  cachedList: Cell[] | null = null;
  cachedMatrix: CellMat | null = null;
  literals: Record<string, number> = { wrapCount: 3 };
  width = 180; height = 200;

  passthrough = (): PassthroughSpec[] => [{
    output: "result",
    inputs: [this.op === "wraprows" || this.op === "wrapcols" ? "list" : "matrix"],
    combine: "single",
  }];

  constructor(init?: { label?: string; op?: TableReshapeOp; scanBy?: "row" | "col"; skipCells?: SkipCells }) {
    super("TableReshape");
    this.op    = init?.op    ?? "wraprows";
    this.label = init?.label ?? "";
    this.scanBy = init?.scanBy === "col" ? "col" : "row";
    this.skipCells = SKIP_BY_CODE.includes(init?.skipCells as SkipCells) ? init!.skipCells! : "none";
    for (const k of TableReshapeNode.inputKeysFor(this.op)) this.addInput(k, TableReshapeNode.inputFor(k));
    this.addOutput("result", TableReshapeNode.outputFor(this.op));
    if (this.op === "wraprows" || this.op === "wrapcols") this.height = 235;
  }

  static inputKeysFor(op: TableReshapeOp): string[] {
    return op === "wraprows" || op === "wrapcols" ? ["list", "wrapCount", "fill"] : ["matrix"];
  }
  static inputFor(key: string) {
    return key === "list" ? anyListIn("List") : key === "wrapCount" ? numIn("Wrap count") : key === "fill" ? anyIn("Fill") : anyTableIn("Matrix");
  }
  /** TOROW answers a list (a row); every other op a table, TOCOL's with one column ([[D85]] columnsStayColumns). */
  static outputFor(op: TableReshapeOp) {
    return op === "torow" ? adoptiveListOut("List") : op === "tocol" ? adoptiveTableOut("Column") : adoptiveTableOut("Table");
  }

  keysDroppedBySwitch(next: TableReshapeOp): string[] {
    const keep = new Set(TableReshapeNode.inputKeysFor(next));
    return Object.keys(this.inputs).filter((k) => !keep.has(k));
  }

  /** Reshapes in place and fires no connection event: the caller prunes the departing inputs' cables before and retypes the output's after. */
  setOp(next: TableReshapeOp): { outputChanged: boolean } {
    if (next === this.op) return { outputChanged: false };
    const before = TableReshapeNode.outputFor(this.op).socket;
    this.op = next;
    for (const k of this.keysDroppedBySwitch(next)) this.removeInput(k);
    for (const k of TableReshapeNode.inputKeysFor(next)) if (!this.inputs[k]) this.addInput(k, TableReshapeNode.inputFor(k));
    const spec = TableReshapeNode.outputFor(next);
    this.outputs.result!.socket = spec.socket;
    this.outputs.result!.label = spec.label;
    return { outputChanged: spec.socket !== before };
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: CellMat | Cell[] | SolError | null };
  }
}

// ─── CHOOSEROWS / CHOOSECOLS ──────────────────────────────────────────────────

export type TableSelectOp = "chooserows" | "choosecols";

export const TABLE_SELECT_OP_META = {
  chooserows: { label: "CHOOSEROWS", description: "Selects rows from a table by 1-based index list. Excel: `CHOOSEROWS`." },
  choosecols: { label: "CHOOSECOLS", description: "Selects columns from a table by 1-based index list. Excel: `CHOOSECOLS`." },
} satisfies Record<TableSelectOp, { label: string; description: string }>;

export class TableSelectNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    indices: "1-based. Negative indices count from the end. A zero or out-of-range index errors the whole result; a blank index is skipped.",
  };
  static inputRoles = rolesFrom("CHOOSEROWS", { indices: 1 });

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
    this.addInput("indices", listIn(this.op === "chooserows" ? "Row indices" : "Col indices"));
    this.addOutput("result", adoptiveTableOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    return nodeOnCore(this, inputs) as { result: CellMat | SolError | null };
  }
}

// ─── TAKE / DROP ───────────────────────────────────────────────────────────────

export type TakeDropOp = "take" | "drop";

export const TAKEDROP_OP_META = {
  take: { label: "TAKE", description: "Keeps rows or columns from the edges of a table or list: positive counts from the start, negative from the end, `0` keeps all. A list is one row, so its items are columns. Excel: `TAKE`." },
  drop: { label: "DROP", description: "Removes rows or columns from the edges of a table or list: positive counts from the start, negative from the end, `0` removes none. A list is one row, so its items are columns. Excel: `DROP`." },
} satisfies Record<TakeDropOp, { label: string; description: string }>;

export class TakeDropNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    rows: "Positive counts from the start, negative from the end, 0 keeps all. A list is one row, so this keeps it whole.",
    cols: "Positive counts from the start, negative from the end, 0 keeps all. A list's items count as columns.",
  };
  static inputRoles = rolesFrom("TAKE", { rows: 1, cols: 2 });
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
    this.addInput("rows", numIn("Rows"));
    this.addInput("cols", numIn("Cols"));
    this.addOutput("result", adoptiveDataOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>): { result: unknown } {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── EXPAND ───────────────────────────────────────────────────────────────────

export class ExpandNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    rows: "Target row count. 0 keeps the current count.",
    cols: "Target column count. 0 keeps the current count.",
  };
  static inputRoles = rolesFrom("EXPAND", { rows: 1, cols: 2 });
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

  data(inputs: Record<string, unknown[] | undefined>): { result: CellMat | SolError | null } {
    return nodeOnCore(this, inputs) as { result: CellMat | SolError | null };
  }
}

// ─── SET CELL ─────────────────────────────────────────────────────────────────

export class SetCellNode extends GraphNode {
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
    return nodeOnCore(this, inputs) as { result: CellMat | SolError | null };
  }
}

// ─── ROWS / COLUMNS ───────────────────────────────────────────────────────────

export class TableInfoNode extends GraphNode {
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

  /** A frame reaches the body as its zero-row preview, the columns without their cells and the row count: a ref's
   *  read from the backend, a value's taken here, so no frame crosses whole only to be counted. */
  data(inputs: { matrix?: unknown[] }) {
    const input = inputs.matrix?.[0];
    if (isFrameRef(input)) {
      return (async () => this.body({ preview: [await materialize(collectPreview(input, 0))] }))() as unknown as { rows: number | null; cols: number | null };
    }
    return this.body(isFrameValue(input) ? { preview: [rowless(input)] } : inputs);
  }

  body(inputs: Record<string, unknown[] | undefined>): { rows: number | SolError | null; cols: number | SolError | null } {
    return nodeOnCore(this, inputs) as { rows: number | SolError | null; cols: number | SolError | null };
  }
}

/** A frame's zero-row preview: its columns without their cells, and its row count. */
function rowless(f: FrameValue): FrameValue {
  return { __frame: true, columns: f.columns.map((c) => ({ name: c.name, type: c.type, values: [] })), __totalRows: f.__totalRows ?? frameRowCount(f) };
}

// ─── SOLVE (A·x = b) ──────────────────────────────────────────────────────────
export class MatSolveNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: number[] | SolError | null };
  }
}

// ─── EIGEN (symmetric) ────────────────────────────────────────────────────────
export class MatEigenNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { values: number[] | SolError | null; vectors: Mat | SolError | null };
  }
}
