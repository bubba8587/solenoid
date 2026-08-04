// ─── The computed-column core — one row-wise evaluator, many surfaces ─────────
// The per-row rules (binding precedence, builtins, bracket references, the
// error/null contract) live HERE once; a surface only supplies its port plumbing.

import type { FrameValue, FrameColumn, FrameCell } from "./frame";
import type { ExprEvaluator } from "./excelFormula";
import type { LambdaValue } from "./lambdaValue";
import { isSolError, solError, type SolError } from "./errorValue";

/** What defines the column's math: a compiled inline formula (with its
 *  extracted variables), or a LambdaValue (params play the variable role). */
export type ComputedSpec =
  | { kind: "expr"; evaluator: ExprEvaluator; vars: string[] }
  | { kind: "lambda"; lam: LambdaValue };

/** How one variable resolves. `col` is a ROW-bound column (λ params);
 *  `wholecol` is the whole column as a list (bare variables in an inline expr). */
type Binding =
  | { kind: "col"; col: FrameColumn }
  | { kind: "wholecol"; col: FrameColumn }
  | { kind: "row" }
  | { kind: "rows" }
  | { kind: "side"; value: unknown };

// ─── The dynamic row context — what `@price` and `[Unit Price]` read ─────────
// The core pushes an accessor for the current row around every evaluation (the
// inline expr AND a wired λ's body alike — dynamic scope is what lets a ZERO-param
// λ read `@price` with no binding ceremony). Synchronous by construction: the
// engine's recompute is single-threaded, and nesting stacks cleanly.
type RowFrame = {
  /** Column / builtin resolution — a hit is authoritative. */
  strong: (name: string) => { hit: boolean; v?: unknown };
  /** The surface's side value (or its miss error), this-row indexed. */
  side: (name: string) => unknown;
  /** This-row read of an arbitrary value: a row-aligned list reads its
   *  element (length-checked), a scalar reads the same every row. */
  at: (name: string, v: unknown) => unknown;
  /** WHOLE-value resolution (`[Name]`): the column as a list, else the
   *  surface's side value verbatim, else a miss #REF!. */
  whole: (name: string) => unknown;
};
const rowStack: RowFrame[] = [];

/** Resolve a this-row reference (`@name`, `@[Name]`). `fallback` is the
 *  evaluator's window into the CURRENT definition's environment (λ captures,
 *  expr variables) — consulted after columns/builtins, before the surface's
 *  side values. Outside any row context the reference is meaningless — a
 *  targeted #REF!, not a typo's #NAME?. */
export function readRowCell(name: unknown, fallback?: () => { hit: boolean; v?: unknown }): unknown {
  const top = rowStack[rowStack.length - 1];
  if (!top) return solError("#REF!", "@ reads the current row — it works inside a computed column");
  const key = String(name);
  const direct = top.strong(key);
  if (direct.hit) return direct.v;
  const fb = fallback?.();
  if (fb?.hit) return top.at(key, fb.v);
  return top.side(key);
}

/** Resolve a WHOLE-column reference (`[Unit Price]` — the bracket form, for a
 *  name a variable can't spell): the column as a list, else the surface's
 *  side value whole. Outside any row context: the same targeted #REF!. */
export function readWholeColumn(name: unknown): unknown {
  const top = rowStack[rowStack.length - 1];
  if (!top) return solError("#REF!", "[column] reads a table column whole — it works inside a computed column");
  return top.whole(String(name));
}

function withRow<T>(frame: RowFrame, f: () => T): T {
  rowStack.push(frame);
  try { return f(); } finally { rowStack.pop(); }
}

/** One computed cell, tagged: SolErrors pass, NaN is #DOMAIN! (op-level guards
 *  inside the evaluator already classified overflow — a surviving ±Inf is a
 *  definable infinity), a non-scalar result refuses (#SHAPE! — one value per
 *  row), undefined reads as blank. */
export function tagComputedCell(v: unknown): FrameCell {
  if (isSolError(v)) return v;
  if (typeof v === "number") {
    return Number.isNaN(v) ? solError("#DOMAIN!", "The result is undefined: not a number") : v;
  }
  if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
  if (v === undefined) return null;
  if (Array.isArray(v)) return solError("#SHAPE!", "A computed column needs one value per row — @name reads this row's cell");
  return solError("#VALUE!", "A computed column needs a number, text, boolean, or blank per row");
}

export interface ComputeColumnOptions {
  /** Names a variable may NOT take on this surface (its own port keys). */
  reserved?: readonly string[];
  /** The surface's side-value lookup (a wired input, an inline literal…).
   *  Called once per side variable — side values are row-invariant by
   *  contract. `kind` says how the name is being read: bound as a variable
   *  ("var"), or reached by `@name`/`[Name]` from inside a row ("row") —
   *  a surface with no side ports can word its refusal per path. */
  sideValue?: (name: string, kind: "var" | "row") => unknown;
  /** The definition's row-context reads (`rowRefNames(expr)`) that the
   *  definition does NOT already own (a λ's captured names are excluded —
   *  those ride the Lambda card): an @name here that matches no column joins
   *  `sideVars`, so the surface grows a port for it — wire a ROW-ALIGNED
   *  list there and `@name` reads this row's element (length-checked), a
   *  scalar reads the same every row. */
  rowRefs?: readonly string[];
  /** Explicit variable → column bindings (the binding pickers). An aliased
   *  variable is ALWAYS a column read of its target — it skips the by-name /
   *  builtin / side-value ladder entirely, and a target the frame lacks is a
   *  whole-column #REF! naming it (an explicit binding gone stale is an
   *  error, never a silent fallback). */
  alias?: Record<string, string | undefined>;
}

export interface ComputedColumnResult {
  cells: FrameCell[];
  /** The variables that bound to SIDE values, in first-appearance order —
   *  the surface grows/prunes its side ports from this. */
  sideVars: string[];
}

/** Compute one column's cells over `f`, row by row. Returns the cells plus the
 *  side-variable list, or a whole-column SolError (a reserved name). */
export function computeColumnCells(
  f: FrameValue,
  spec: ComputedSpec,
  opts: ComputeColumnOptions = {},
): ComputedColumnResult | SolError {
  const params = spec.kind === "lambda" ? spec.lam.params : spec.vars;
  const reserved = opts.reserved ?? [];

  // A λ PARAM binds this row's cell; a bare inline-expr VARIABLE binds the WHOLE
  // column. Explicit picker bindings follow the same split.
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
    bindings.push({ kind: "side", value: opts.sideValue?.(p, "var") ?? 0 });
  }
  // An @name that matches no column is a SIDE name too — surfaces grow a port
  // for it (a row-aligned list, or a scalar read the same every row).
  for (const p of opts.rowRefs ?? []) {
    if (p === "row" || p === "rows" || reserved.includes(p)) continue;
    if (f.columns.some((c) => c.name === p)) continue;
    if (!sideVars.includes(p)) sideVars.push(p);
  }

  const rows = f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
  // One frame object serves every row via the cursor; columns pre-indexed in a Map
  // so an @-read is O(1). Exact name match — a numeric name is a NAME, never a
  // positional index. Side values are cached: row-invariant by contract.
  let cursor = 0;
  const colByName = new Map(f.columns.map((c) => [c.name, c] as const));
  const sideCache = new Map<string, unknown>();
  // The list VALIDATION (matrix scan + length) is memoized per name — @-values are
  // row-invariant by contract, and an O(list) matrix scan per row would make an
  // @-list read quadratic in rows.
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
  const rowFrame: RowFrame = {
    strong: (key) => {
      const c = colByName.get(key);
      if (c) return { hit: true, v: c.values[cursor] ?? null };
      if (key === "row") return { hit: true, v: cursor + 1 };
      if (key === "rows") return { hit: true, v: rows };
      return { hit: false };
    },
    side: (key) => {
      if (reserved.includes(key)) return solError("#REF!", `"${key}" is a reserved input name — rename the variable or the column`);
      if (!sideCache.has(key)) sideCache.set(key, opts.sideValue?.(key, "row") ?? 0);
      return at(key, sideCache.get(key));
    },
    at,
    whole: (key) => {
      const c = colByName.get(key);
      if (c) return c.values;
      if (reserved.includes(key)) return solError("#REF!", `"${key}" is a reserved input name — rename the variable or the column`);
      if (!sideCache.has(key)) sideCache.set(key, opts.sideValue?.(key, "row") ?? 0);
      return sideCache.get(key);
    },
  };

  const cells: FrameCell[] = [];
  for (let i = 0; i < rows; i++) {
    cursor = i;
    // Frame cells are plain values — units live on the COLUMN (D20), so there is
    // nothing to unwrap per cell.
    const rowCells = bindings.map((b) =>
      b.kind === "col" ? (b.col.values[i] ?? null)
      : b.kind === "wholecol" ? b.col.values
      : b.kind === "row" ? i + 1
      : b.kind === "rows" ? rows
      : b.value);
    const errIdx = bindings.findIndex((b, k) => b.kind === "col" && isSolError(rowCells[k]));
    if (errIdx >= 0) { cells.push(rowCells[errIdx] as SolError); continue; }
    const r = withRow(rowFrame, () => {
      if (spec.kind === "lambda") {
        try { return spec.lam.fn(...rowCells); } catch (e) {
          return isSolError(e) ? e : solError("#VALUE!", e instanceof Error ? e.message : String(e));
        }
      }
      const env: Record<string, unknown> = {};
      params.forEach((p, k) => { env[p] = rowCells[k]; });
      return spec.evaluator(env);
    });
    cells.push(tagComputedCell(r));
  }
  return { cells, sideVars };
}
