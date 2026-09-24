// [[D41]] formatFlowsDownstream, [[C25]] firstClassUnits
// Duck-typed on purpose: this module imports no node classes, so the resolver and the nodes share it without a cycle.

export interface FormatCarrySpec {
  output: string;
  /** Priority order: the first wired, annotated input of the same element family wins. */
  inputs: string[];
}

interface HasFormatCarry { formatCarry(): FormatCarrySpec[]; }

export function getFormatCarry(n: unknown): FormatCarrySpec[] {
  const f = (n as Partial<HasFormatCarry> | null)?.formatCarry;
  return typeof f === "function" ? f.call(n) : [];
}

export function formatCarryForOutput(n: unknown, outKey: string): FormatCarrySpec | undefined {
  return getFormatCarry(n).find((s) => s.output === outKey);
}
