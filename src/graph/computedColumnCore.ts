// [[C22]] rowFormulaRefs, [[C54]] noPerCellFormulas
import type { FrameCell, CubeCell } from "./frame";
import type { ExprEvaluator } from "./excelFormula";
import type { LambdaValue } from "./lambdaValue";
import { isSolError, solError, type SolError } from "./errorValue";

export type ComputedSpec =
  | { kind: "expr"; evaluator: ExprEvaluator; vars: string[] }
  | { kind: "lambda"; lam: LambdaValue };

/** A column a row formula reads: `values` per row, and `whole` when the whole column is not simply `values`. */
export interface RowColumn {
  name: string;
  values: readonly unknown[];
  whole?: unknown;
}
export interface RowTable { columns: readonly RowColumn[] }

type Binding =
  | { kind: "col"; col: RowColumn }
  | { kind: "wholecol"; col: RowColumn }
  | { kind: "side"; value: unknown };

type RowFrame = {
  strong: (name: string) => { hit: boolean; v?: unknown };
  side: (name: string) => unknown;
  at: (name: string, v: unknown) => unknown;
  whole: (name: string) => unknown;
  column: (name: string) => { hit: boolean; v?: unknown };
  index: () => number;
};
const rowStack: RowFrame[] = [];

export function readRowCell(name: unknown, fallback?: () => { hit: boolean; v?: unknown }): unknown {
  const top = rowStack[rowStack.length - 1];
  if (!top) return solError("#REF!", "@ reads the current row, so it only works inside a computed column");
  const key = String(name);
  const direct = top.strong(key);
  if (direct.hit) return direct.v;
  const fb = fallback?.();
  if (fb?.hit) return top.at(key, fb.v);
  return top.side(key);
}

export function readWholeColumn(name: unknown): unknown {
  const top = rowStack[rowStack.length - 1];
  if (!top) return solError("#REF!", "[column] reads a whole table column, so it only works inside a computed column");
  return top.whole(String(name));
}

/** ROW(): this row's 1-based number, read from the innermost computed column. */
export function currentRowNumber(): number | SolError {
  const top = rowStack[rowStack.length - 1];
  return top ? top.index() : solError("#NAME?", "ROW() is this row's number, so it only works inside a computed column");
}

/** A LAMBDA's bare captured name that names a column reads that whole column, since a column outranks a capture. */
export function readCapturedColumn(name: string): { hit: boolean; v?: unknown } {
  const top = rowStack[rowStack.length - 1];
  return top ? top.column(name) : { hit: false };
}

function withRow<T>(frame: RowFrame, f: () => T): T {
  rowStack.push(frame);
  try { return f(); } finally { rowStack.pop(); }
}

/** A whole column is a column, as an Excel table column is: a one-column table, so ROWS(price) is the row count. */
const wholeOf = (c: RowColumn): unknown => ("whole" in c ? c.whole : c.values.map((v) => [v]));

export function tagComputedCell(v: unknown): FrameCell {
  if (isSolError(v)) return v;
  if (typeof v === "number") {
    return Number.isNaN(v) ? solError("#DOMAIN!", "The result is undefined: not a number") : v;
  }
  if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
  if (v === undefined) return null;
  if (Array.isArray(v)) return solError("#SHAPE!", "A computed column needs one value per row. Use @name to read this row's cell.");
  return solError("#VALUE!", "Each row of a computed column must be a number, text, TRUE/FALSE or blank.");
}

export interface ComputeColumnOptions {
  reserved?: readonly string[];
  sideValue?: (name: string, kind: "var" | "row") => unknown;
  rowRefs?: readonly string[];
  alias?: Record<string, string | undefined>;
}

/** A Cube row can hold a list or a grid, so a list answer is that row's cell; its items are tagged as scalar answers are. */
export function tagCubeComputedCell(v: unknown): CubeCell {
  if (!Array.isArray(v)) return tagComputedCell(v);
  return v.map((x) => (Array.isArray(x)
    ? x.map((y) => (Array.isArray(y) ? solError("#SHAPE!", "A row's answer can be a list or a grid, not deeper") : tagComputedCell(y)))
    : tagComputedCell(x)));
}

export interface ComputedColumnResult<C = FrameCell> {
  cells: C[];
  sideVars: string[];
}

export function computeColumnCells(f: RowTable, spec: ComputedSpec, opts: ComputeColumnOptions = {}): ComputedColumnResult | SolError {
  return runColumn(f, spec, opts, tagComputedCell);
}

export function computeCubeColumnCells(f: RowTable, spec: ComputedSpec, opts: ComputeColumnOptions = {}): ComputedColumnResult<CubeCell> | SolError {
  return runColumn(f, spec, opts, tagCubeComputedCell);
}

function runColumn<C>(
  f: RowTable,
  spec: ComputedSpec,
  opts: ComputeColumnOptions,
  tag: (v: unknown) => C,
): ComputedColumnResult<C> | SolError {
  const params = spec.kind === "lambda" ? spec.lam.params : spec.vars;
  const reserved = opts.reserved ?? [];

  const colKind = spec.kind === "lambda" ? ("col" as const) : ("wholecol" as const);
  const rows = f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
  // A wired list with one value per row is per-row data, so it reads as a column beside the table's ([[D85]] columnsStayColumns).
  const aligned = (v: unknown): unknown =>
    Array.isArray(v) && v.length === rows && rows > 1 && !v.some(Array.isArray) ? v.map((x) => [x]) : v;
  const bindings: Binding[] = [];
  const sideVars: string[] = [];
  for (const p of params) {
    const target = opts.alias?.[p];
    if (target !== undefined) {
      const bound = f.columns.find((c) => c.name === target);
      if (!bound) return solError("#REF!", `No column "${target}" to bind "${p}" to`);
      bindings.push({ kind: colKind, col: bound });
      continue;
    }
    const col = f.columns.find((c) => c.name === p);
    if (col) { bindings.push({ kind: colKind, col }); continue; }
    if (reserved.includes(p)) {
      return solError("#REF!", `"${p}" is a reserved input name. Rename the variable or the column`);
    }
    sideVars.push(p);
    bindings.push({ kind: "side", value: aligned(opts.sideValue?.(p, "var")) });
  }
  for (const p of opts.rowRefs ?? []) {
    if (reserved.includes(p)) continue;
    const target = opts.alias?.[p];
    if (target !== undefined) {
      if (!f.columns.some((c) => c.name === target)) return solError("#REF!", `No column "${target}" to bind "${p}" to`);
      continue;
    }
    if (f.columns.some((c) => c.name === p)) continue;
    if (!sideVars.includes(p)) sideVars.push(p);
  }

  let cursor = 0;
  const colByName = new Map(f.columns.map((c) => [c.name, c] as const));
  const sideCache = new Map<string, unknown>();
  // Memoized per name, since validating the list on every row would be quadratic.
  const atVerdict = new Map<string, { v: unknown; err: SolError | null }>();
  const at = (key: string, v: unknown): unknown => {
    if (!Array.isArray(v)) return v;
    let m = atVerdict.get(key);
    if (!m || m.v !== v) {
      const err = v.some((x) => Array.isArray(x))
        ? solError("#SHAPE!", `@${key} reads one value per row, and a matrix has no single this-row value`)
        : v.length !== rows
          ? solError("#SHAPE!", `@${key}: ${v.length} value${v.length === 1 ? "" : "s"} for ${rows} row${rows === 1 ? "" : "s"}`)
          : null;
      m = { v, err };
      atVerdict.set(key, m);
    }
    if (m.err) return m.err;
    return (v as unknown[])[cursor] ?? null;
  };
  const aliased = (key: string) => {
    const target = opts.alias?.[key];
    return target === undefined ? undefined : colByName.get(target);
  };
  const wholes = new Map<RowColumn, unknown>();
  const wholeCol = (c: RowColumn): unknown => {
    if (!wholes.has(c)) wholes.set(c, wholeOf(c));
    return wholes.get(c);
  };
  const rowFrame: RowFrame = {
    strong: (key) => {
      const c = aliased(key) ?? colByName.get(key);
      return c ? { hit: true, v: c.values[cursor] ?? null } : { hit: false };
    },
    side: (key) => {
      if (reserved.includes(key)) return solError("#REF!", `"${key}" is a reserved input name. Rename the variable or the column`);
      if (!sideCache.has(key)) sideCache.set(key, opts.sideValue?.(key, "row"));
      return at(key, sideCache.get(key));
    },
    at,
    whole: (key) => {
      const c = aliased(key) ?? colByName.get(key);
      if (c) return wholeCol(c);
      if (reserved.includes(key)) return solError("#REF!", `"${key}" is a reserved input name. Rename the variable or the column`);
      if (!sideCache.has(key)) sideCache.set(key, opts.sideValue?.(key, "row"));
      return aligned(sideCache.get(key));
    },
    column: (key) => {
      const c = aliased(key) ?? colByName.get(key);
      return c ? { hit: true, v: wholeCol(c) } : { hit: false };
    },
    index: () => cursor + 1,
  };

  const cells: C[] = [];
  if (spec.kind === "expr") {
    // Every expr binding is a whole column or a side value, so one env serves every row.
    const env: Record<string, unknown> = {};
    bindings.forEach((b, k) => { env[params[k]] = b.kind === "side" ? b.value : wholeCol(b.col); });
    rowStack.push(rowFrame);
    try {
      for (let i = 0; i < rows; i++) {
        cursor = i;
        let r: unknown;
        try { r = spec.evaluator(env); } catch (e) {
          r = isSolError(e) ? e : solError("#VALUE!", e instanceof Error ? e.message : String(e));
        }
        cells.push(tag(r));
      }
    } finally { rowStack.pop(); }
    return { cells, sideVars };
  }
  for (let i = 0; i < rows; i++) {
    cursor = i;
    const rowCells = bindings.map((b) =>
      b.kind === "col" ? (b.col.values[i] ?? null)
      : b.kind === "wholecol" ? wholeCol(b.col)
      : b.value);
    const errIdx = bindings.findIndex((b, k) => b.kind === "col" && isSolError(rowCells[k]));
    if (errIdx >= 0) { cells.push(rowCells[errIdx] as C); continue; }
    const r = withRow(rowFrame, () => {
      try {
        return spec.lam.fn(...rowCells);
      } catch (e) {
        return isSolError(e) ? e : solError("#VALUE!", e instanceof Error ? e.message : String(e));
      }
    });
    cells.push(tag(r));
  }
  return { cells, sideVars };
}
