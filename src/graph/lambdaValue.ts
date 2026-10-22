// [[C17]] shareImpl (rete-free: the formula path constructs and consumes lambdas), [[C50]] lambdaBindsByName, [[C24]] arraySemantics

export interface LambdaValue {
  __lambda: true;
  params: string[];
  fn: (...args: unknown[]) => unknown;
  expr: string;
  captured?: string[];
  /** The captured values with their units, beside `captured`; `fn` reads them unit-blind, as the numbers they show. */
  capturedValues?: readonly unknown[];
  /** The same lambda reading other captured values, so a reader that runs in base SI can hand them over in it. */
  withCaptures?: (values: readonly unknown[]) => LambdaValue;
  /** The values `fn` reads for the captures (the shown numbers, or a plan's magnitudes): the core runs the body on them ([[C130]] rustCore). */
  readValues?: readonly unknown[];
  /** A host calls an eta lambda with its meaningful arity only, never trailing row, col or pad arguments. */
  eta?: true;
  descriptions?: Record<string, string>;
}

export function isLambdaValue(v: unknown): v is LambdaValue {
  return (
    typeof v === "object" && v !== null &&
    (v as { __lambda?: unknown }).__lambda === true &&
    typeof (v as { fn?: unknown }).fn === "function"
  );
}
