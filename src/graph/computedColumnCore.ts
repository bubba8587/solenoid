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
   *  Called once per side variable, before the row loop — side values are
   *  row-invariant by contract. */
  sideValue?: (name: string) => unknown;
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
    const col = f.columns.find((c) => c.name === p);
    if (col) { bindings.push({ kind: "col", col }); continue; }
    if (p === "row") { bindings.push({ kind: "row" }); continue; }
    if (p === "rows") { bindings.push({ kind: "rows" }); continue; }
    if (reserved.includes(p)) {
      return solError("#REF!", `"${p}" is a reserved input name — rename the variable or the column`);
    }
    sideVars.push(p);
    bindings.push({ kind: "side", value: opts.sideValue?.(p) ?? 0 });
  }

  const rows = f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
  // The `col` accessor: one closure serves every row via the cursor.
  let cursor = 0;
  const colAccessor = {
    __lambda: true as const, params: ["name"], expr: "",
    fn: (nm: unknown) => {
      const key = String(nm);
      const c = f.columns.find((cc) => cc.name === key);
      return c ? (c.values[cursor] ?? null) : solError("#REF!", `No column "${key}"`);
    },
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
    let r: unknown;
    if (spec.kind === "lambda") {
      try { r = spec.lam.fn(...rowCells); } catch (e) {
        r = isSolError(e) ? e : solError("#VALUE!", e instanceof Error ? e.message : String(e));
      }
    } else {
      const env: Record<string, unknown> = { col: colAccessor };
      params.forEach((p, k) => { env[p] = rowCells[k]; });
      r = spec.evaluator(env);
    }
    cells.push(tagComputedCell(r));
  }
  return { cells, sideVars };
}
