// Must stay RETE-FREE (FX-2): the formula path constructs and consumes lambdas
// without loading the editor.

export interface LambdaValue {
  __lambda: true;
  params: string[];
  // Value-polymorphic: a lambda body may return text or a date serial, not just
  // a number.
  fn: (...args: unknown[]) => unknown;
  /** The source body, carried so a consumer can RENDER the formula; empty for a
   *  bare lambda. */
  expr: string;
  /** Body variables that are NOT params, captured as closure constants — a by-name
   *  consumer warns when one collides with its own variable names. */
  captured?: string[];
  /** A bare function name passed where a lambda belongs (`MAP(x, SQRT)`). Declares
   *  NO params, so a host must call it with its MEANINGFUL arity only, or a scalar
   *  function computes on the host's row/col/pad arguments. */
  eta?: true;
  /** Per-variable prose for a Report's "where:" legend; kept out of `expr`. */
  descriptions?: Record<string, string>;
}

export function isLambdaValue(v: unknown): v is LambdaValue {
  return (
    typeof v === "object" && v !== null &&
    (v as { __lambda?: unknown }).__lambda === true &&
    typeof (v as { fn?: unknown }).fn === "function"
  );
}
