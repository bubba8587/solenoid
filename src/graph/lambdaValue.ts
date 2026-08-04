// ─── Tagged lambda values — the function currency (VAL-15's shape rules) ──────
// A lambda is a TAGGED OBJECT flowing between the LAMBDA node, the host nodes
// (MAP/BYROW/…) and the formula language's own LAMBDA(...) special form.
// RETE-FREE (FX-2): the formula path constructs and consumes these without
// loading the editor. nodes/lambda.ts re-exports for its importers.

export interface LambdaValue {
  __lambda: true;
  params: string[];
  // Value-polymorphic, like the underlying compiled formula: a lambda body can
  // return text or a date serial, not just a number (polyform).
  fn: (...args: unknown[]) => unknown;
  /** The source body expression — carried so a consumer can RENDER the formula
   *  (e.g. the Report shows a wired lambda as KaTeX). Empty for a bare lambda. */
  expr: string;
  /** The body variables that are NOT params (captured as closure constants). A
   *  by-name consumer uses this to warn when one collides with its own variable
   *  names — the user meant a live value but got a captured constant. */
  captured?: string[];
  /** ETA wrapper — a bare function name passed where a lambda belongs
   *  (`MAP(x, SQRT)`). Declares NO params, so a host must call it with its
   *  MEANINGFUL arity only (etaFn in excelFunctions.ts) — a raw scalar function
   *  must not receive the host's full argument tuple (row/col indices, pad
   *  slots) or it computes on them. */
  eta?: true;
  /** Optional per-variable prose (var name → description), carried so a Report
   *  embed can show a "where:" legend under the formula. Kept out of `expr`. */
  descriptions?: Record<string, string>;
}

export function isLambdaValue(v: unknown): v is LambdaValue {
  return (
    typeof v === "object" && v !== null &&
    (v as { __lambda?: unknown }).__lambda === true &&
    typeof (v as { fn?: unknown }).fn === "function"
  );
}
