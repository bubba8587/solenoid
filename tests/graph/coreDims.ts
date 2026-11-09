// [[C25]] firstClassUnits, [[D99]] rustIsSpec
// A formula's dimension as the core reads it (`engine_dim_eval`, unit_dims.rs), for the tests that pin the algebra.
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { solError, type SolError, type SolErrorCode } from "../../src/graph/errorValue";

export type Dim = Record<string, number>;

/** The dimension (exponents as numbers) with its currency code; null where it is indeterminate, or the error. */
export function dimWithCode(src: string, env: Record<string, Dim> = {}, codes: Record<string, string> = {},
  fns?: Record<string, [string[], string]>): { dim: Dim; code?: string } | SolError | null {
  const r = wasmInvokeSync<{ parses?: false; dim?: [string, string][]; code?: string | null; indeterminate?: true; err?: string; msg?: string }>(
    "engine_dim_eval", { src, env, codes, ...(fns ? { fns } : {}) });
  if (r.parses === false) throw new Error(`unparseable: ${src}`);
  if (r.indeterminate) return null;
  if (r.err !== undefined) return solError(r.err as SolErrorCode, r.msg ?? "");
  const dim = Object.fromEntries(r.dim!.map(([k, v]) => [k, Number(v)]));
  return r.code == null ? { dim } : { dim, code: r.code };
}

/** The dimension alone. */
export function dimOf(src: string, env: Record<string, Dim> = {}, codes: Record<string, string> = {}): Dim | SolError | null {
  const r = dimWithCode(src, env, codes);
  return r === null ? null : "dim" in r ? r.dim : r;
}
