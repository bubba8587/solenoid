// [[C17]] shareImpl (rete-free: the formula path constructs and consumes lambdas), [[C50]] lambdaBindsByName, [[C24]] arraySemantics

export interface LambdaValue {
  __lambda: true;
  params: string[];
  fn: (...args: unknown[]) => unknown;
  expr: string;
  captured?: string[];
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
