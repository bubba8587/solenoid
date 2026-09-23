// [[C22]] rowFormulaRefs, [[C54]] noPerCellFormulas
import type { FrameValue, FrameColumn, FrameCell } from "./frame";
import type { ExprEvaluator } from "./excelFormula";
import type { LambdaValue } from "./lambdaValue";
import { isSolError, solError, type SolError } from "./errorValue";

export type ComputedSpec =
  | { kind: "expr"; evaluator: ExprEvaluator; vars: string[] }
  | { kind: "lambda"; lam: LambdaValue };

type Binding =
  | { kind: "col"; col: FrameColumn }
  | { kind: "wholecol"; col: FrameColumn }
  | { kind: "row" }
  | { kind: "rows" }
  | { kind: "side"; value: unknown };

type RowFrame = {
  strong: (name: string) => { hit: boolean; v?: unknown };
  side: (name: string) => unknown;
  at: (name: string, v: unknown) => unknown;
  whole: (name: string) => unknown;
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

function withRow<T>(frame: RowFrame, f: () => T): T {
  rowStack.push(frame);
  try { return f(); } finally { rowStack.pop(); }
}

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

export interface ComputedColumnResult {
  cells: FrameCell[];
  sideVars: string[];
}

export function computeColumnCells(
  f: FrameValue,
  spec: ComputedSpec,
  opts: ComputeColumnOptions = {},
): ComputedColumnResult | SolError {
  const params = spec.kind === "lambda" ? spec.lam.params : spec.vars;
  const reserved = opts.reserved ?? [];

  const colKind = spec.kind === "lambda" ? ("col" as const) : ("wholecol" as const);
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
    if (p === "row") { bindings.push({ kind: "row" }); continue; }
    if (p === "rows") { bindings.push({ kind: "rows" }); continue; }
    if (reserved.includes(p)) {
      return solError("#REF!", `"${p}" is a reserved input name — rename the variable or the column`);
    }
    sideVars.push(p);
    bindings.push({ kind: "side", value: opts.sideValue?.(p, "var") });
  }
  for (const p of opts.rowRefs ?? []) {
    if (p === "row" || p === "rows" || reserved.includes(p)) continue;
    const target = opts.alias?.[p];
    if (target !== undefined) {
      if (!f.columns.some((c) => c.name === target)) return solError("#REF!", `No column "${target}" to bind "${p}" to`);
      continue;
    }
    if (f.columns.some((c) => c.name === p)) continue;
    if (!sideVars.includes(p)) sideVars.push(p);
  }

  const rows = f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
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
        ? solError("#SHAPE!", `@${key} reads one value per row — a matrix has no single this-row value`)
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
  const rowFrame: RowFrame = {
    strong: (key) => {
      const c = aliased(key) ?? colByName.get(key);
      if (c) return { hit: true, v: c.values[cursor] ?? null };
      if (key === "row") return { hit: true, v: cursor + 1 };
      if (key === "rows") return { hit: true, v: rows };
      return { hit: false };
    },
    side: (key) => {
      if (reserved.includes(key)) return solError("#REF!", `"${key}" is a reserved input name — rename the variable or the column`);
      if (!sideCache.has(key)) sideCache.set(key, opts.sideValue?.(key, "row"));
      return at(key, sideCache.get(key));
    },
    at,
    whole: (key) => {
      const c = aliased(key) ?? colByName.get(key);
      if (c) return c.values;
      if (reserved.includes(key)) return solError("#REF!", `"${key}" is a reserved input name — rename the variable or the column`);
      if (!sideCache.has(key)) sideCache.set(key, opts.sideValue?.(key, "row"));
      return sideCache.get(key);
    },
  };

  const cells: FrameCell[] = [];
  for (let i = 0; i < rows; i++) {
    cursor = i;
    const rowCells = bindings.map((b) =>
      b.kind === "col" ? (b.col.values[i] ?? null)
      : b.kind === "wholecol" ? b.col.values
      : b.kind === "row" ? i + 1
      : b.kind === "rows" ? rows
      : b.value);
    const errIdx = bindings.findIndex((b, k) => b.kind === "col" && isSolError(rowCells[k]));
    if (errIdx >= 0) { cells.push(rowCells[errIdx] as SolError); continue; }
    const r = withRow(rowFrame, () => {
      try {
        if (spec.kind === "lambda") return spec.lam.fn(...rowCells);
        const env: Record<string, unknown> = {};
        params.forEach((p, k) => { env[p] = rowCells[k]; });
        return spec.evaluator(env);
      } catch (e) {
        return isSolError(e) ? e : solError("#VALUE!", e instanceof Error ? e.message : String(e));
      }
    });
    cells.push(tagComputedCell(r));
  }
  return { cells, sideVars };
}
