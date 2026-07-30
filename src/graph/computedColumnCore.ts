// ─── The computed-column core — one row-wise evaluator, many surfaces ─────────
// A "computed column" is a column whose cells come from a per-row computation
// over the frame's other columns. Several surfaces offer it (author direction
// 2026-07-29: "a very large percentage of Excel work is table computed
// columns"): the Computed Column VERB node today, the Frame Input's per-column
// sources next (docs/v2.0/19-computed-column-surface.md). They must agree on
// every rule — binding precedence, builtins, the col() accessor, the per-row
// error/null contract — so the rules live HERE once, and a surface only
// supplies its own port plumbing.
//
// The contract (mirrors the broadcast rules where they apply, departs where a
// formula is not an element-wise op):
//   • a variable binds, in precedence order: a COLUMN of that name → the
//     `row`/`rows` builtins (1-based row number / total count) → a SIDE value
//     the surface supplies (row-invariant — a wired scalar, a whole list for
//     SUM(...), an inline literal default);
//   • `col("Unit Price")` / `col(2024)` reaches columns a variable can't
//     spell — an env lambda resolved by the evaluator's higher-order call
//     path, name-exact (a numeric literal is a NAME, never an index);
//   • `@name` / `col(name)` resolve per row: the column → the `row`/`rows`
//     builtins → the surface's SIDE value, where a ROW-ALIGNED list reads
//     element-per-row (length-checked against the frame) and a scalar reads
//     the same every row — so a λ's `@list` needs no capture, it rides the
//     table-side node's port;
//   • an error cell in a BOUND column propagates to that row's output (first
//     in binding order); a null flows INTO the formula (ISBLANK can see it);
//   • a NaN result is #DOMAIN!, a list-shaped result is #SHAPE! (one value
//     per row), undefined reads as blank.

import type { FrameValue, FrameColumn, FrameCell } from "./frame";
import type { ExprEvaluator } from "./excelFormula";
import type { LambdaValue } from "./lambdaValue";
import { isSolError, solError, type SolError } from "./errorValue";

/** What defines the column's math: a compiled inline formula (with its
 *  extracted variables), or a LambdaValue (params play the variable role). */
export type ComputedSpec =
  | { kind: "expr"; evaluator: ExprEvaluator; vars: string[] }
  | { kind: "lambda"; lam: LambdaValue };

/** How one variable resolves — see the module note for the precedence. */
type Binding =
  | { kind: "col"; col: FrameColumn }
  | { kind: "row" }
  | { kind: "rows" }
  | { kind: "side"; value: unknown };

// ─── The dynamic row context — what `@price` and `col("price")` read ─────────
// A row formula runs INSIDE a row: the core pushes an accessor for the current
// row around every evaluation (the inline expr AND a wired λ's body alike —
// dynamic scope is what lets a ZERO-param λ read `@price` with no binding
// ceremony), and the `@` operator / the COL function resolve against the top
// of the stack. Synchronous by construction — the engine's recompute is
// single-threaded, and nesting (a λ whose captures carry another computed
// frame) stacks cleanly.
const rowStack: Array<(name: string) => unknown> = [];

/** Resolve a this-row reference (`@name`, `COL(name)`). Outside any row
 *  context the reference is meaningless — a targeted #REF!, not a typo's
 *  #NAME?. */
export function readRowCell(name: unknown): unknown {
  const top = rowStack[rowStack.length - 1];
  if (!top) return solError("#REF!", "@ and col() read the current row — they work inside a computed column");
  return top(String(name));
}

function withRow<T>(accessor: (name: string) => unknown, f: () => T): T {
  rowStack.push(accessor);
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
  if (Array.isArray(v)) return solError("#SHAPE!", "A computed column needs one value per row, not a list");
  return solError("#VALUE!", "A computed column needs a number, text, boolean, or blank per row");
}

export interface ComputeColumnOptions {
  /** Names a variable may NOT take on this surface (its own port keys). */
  reserved?: readonly string[];
  /** The surface's side-value lookup (a wired input, an inline literal…).
   *  Called once per side variable — side values are row-invariant by
   *  contract. `kind` says how the name is being read: bound as a variable
   *  ("var"), or reached by `@name`/`col(name)` from inside a row ("row") —
   *  a surface with no side ports can word its refusal per path. */
  sideValue?: (name: string, kind: "var" | "row") => unknown;
  /** The definition's row-context reads (`rowRefNames(expr)`): an @name that
   *  matches no column joins `sideVars`, so the surface grows a port for it —
   *  wire a ROW-ALIGNED list there and `@name` reads this row's element
   *  (length-checked), a scalar reads the same every row. This is how a λ's
   *  `@list` gets its value WITHOUT a capture: the list is zipped to this
   *  frame's rows, so its port belongs on the table-side node, and the λ
   *  stays frame-agnostic. */
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

  const bindings: Binding[] = [];
  const sideVars: string[] = [];
  for (const p of params) {
    const target = opts.alias?.[p];
    if (target !== undefined) {
      const bound = f.columns.find((c) => c.name === target);
      if (!bound) return solError("#REF!", `No column "${target}" to bind "${p}" to`);
      bindings.push({ kind: "col", col: bound });
      continue;
    }
    const col = f.columns.find((c) => c.name === p);
    if (col) { bindings.push({ kind: "col", col }); continue; }
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
  // The row accessor behind `@name` / `col(name)`: one closure serves every
  // row via the cursor. Exact name match — a numeric name is a NAME, never a
  // positional index. A non-column name falls through to the surface's SIDE
  // value (cached — row-invariant by contract): a list must line up with the
  // frame's rows and reads element-per-row; a scalar reads the same every
  // row; a matrix has no single this-row value.
  let cursor = 0;
  const sideCache = new Map<string, unknown>();
  const rowSide = (key: string): unknown => {
    if (!sideCache.has(key)) sideCache.set(key, opts.sideValue?.(key, "row") ?? 0);
    return sideCache.get(key);
  };
  const rowAccessor = (key: string): unknown => {
    const c = f.columns.find((cc) => cc.name === key);
    if (c) return c.values[cursor] ?? null;
    if (key === "row") return cursor + 1;
    if (key === "rows") return rows;
    if (reserved.includes(key)) return solError("#REF!", `"${key}" is a reserved input name — rename the variable or the column`);
    const v = rowSide(key);
    if (Array.isArray(v)) {
      if (v.some((x) => Array.isArray(x))) return solError("#SHAPE!", `@${key} reads one value per row — a matrix has no single this-row value`);
      if (v.length !== rows) return solError("#SHAPE!", `@${key}: ${v.length} value${v.length === 1 ? "" : "s"} for ${rows} row${rows === 1 ? "" : "s"}`);
      return (v as unknown[])[cursor] ?? null;
    }
    return v;
  };

  const cells: FrameCell[] = [];
  for (let i = 0; i < rows; i++) {
    cursor = i;
    // Frame cells are plain values — units live on the COLUMN (D20), so
    // there is nothing to unwrap per cell.
    const rowCells = bindings.map((b) =>
      b.kind === "col" ? (b.col.values[i] ?? null)
      : b.kind === "row" ? i + 1
      : b.kind === "rows" ? rows
      : b.value);
    const err = rowCells.find((v) => isSolError(v));
    if (err) { cells.push(err as SolError); continue; }
    const r = withRow(rowAccessor, () => {
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
