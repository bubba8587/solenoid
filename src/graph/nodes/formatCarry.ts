// The per-node declaration of which display styles survive a TRANSFORM
// ([[D41]] formatFlowsDownstream). A transform carries NOTHING unless it declares — per
// output — which inputs' style may flow to it, and it declares that only for the ops
// that PRESERVE the meaning of the value: add keeps a percent a percent, multiply
// does not; a mean keeps it, a count does not. The unit is never carried here (it is
// value-level, [[D40]] unitOnValue) — unitFlow strips it off the carried copy.
//
// Duck-typed like passthrough(): this module imports no node classes, so the resolver
// and the nodes share one contract without a cycle.

export interface FormatCarrySpec {
  /** The output socket key that may keep an input's display style. */
  output: string;
  /** The value inputs whose style may flow to `output`, in priority order — the first
   *  wired, annotated, same-element-family input wins (unitFlow.carriedFormat). */
  inputs: string[];
}

interface HasFormatCarry { formatCarry(): FormatCarrySpec[]; }

/** A node's format-carry declarations (empty when it declares none — the default, so
 *  an undeclared transform carries nothing). */
export function getFormatCarry(n: unknown): FormatCarrySpec[] {
  const f = (n as Partial<HasFormatCarry> | null)?.formatCarry;
  return typeof f === "function" ? f.call(n) : [];
}

/** The declaration producing a given output, if the current op carries onto it. */
export function formatCarryForOutput(n: unknown, outKey: string): FormatCarrySpec | undefined {
  return getFormatCarry(n).find((s) => s.output === outKey);
}
