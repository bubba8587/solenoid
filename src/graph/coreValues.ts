// [[C130]] rustCore, [[D99]] rustIsSpec
// Values across the boundary with the Rust core: what a JS value looks like to `eval.rs` `decode_value`, what the
// core's reply (`frame_backend.rs` `call_reply`) looks like back, and the table that lets an error cell come back as
// the very SolError that went in.
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import { isCx, cx } from "./cxValue";
import { isLambdaValue } from "./lambdaValue";
import { isUnitCell, displayScale, displayOffset, displayDim, type UnitCell } from "./unitValue";
import { wallClockSerial } from "./nodes/dateSerial";
import { settingsStore } from "./settingsStore";
import { wasmEngineLoaded, wasmInvokeSync, onCore, onWasmEngineReset } from "./engineWasm";
import { registryGeneration, internalFunctionNames, resolveExcelFunction, normalizeFxResult } from "./excelFunctions";
import { argumentError } from "./excelFormula";

// An uploaded error carries a reference the core hands back, so it returns as the same SolError, message and
// origin included, for as long as the original is alive.
const errorRefs = new Map<number, WeakRef<SolError>>();
const errorIds = new WeakMap<SolError, number>();
let errorSeq = 0;
const errorGone = typeof FinalizationRegistry !== "undefined" ? new FinalizationRegistry<number>((id) => errorRefs.delete(id)) : null;

export function errorRef(e: SolError): number | undefined {
  if (typeof WeakRef === "undefined") return undefined;
  let id = errorIds.get(e);
  if (id === undefined) {
    id = errorSeq = (errorSeq % 0xffff_ffff) + 1;
    errorIds.set(e, id);
    errorRefs.set(id, new WeakRef(e));
    errorGone?.register(e, id);
  }
  return id;
}

/** The error that went in under `ref`, if it is still alive and still this code; else a fresh one. */
export function errorFromCore(code: string, message: string, ref: number | undefined): SolError {
  const original = ref === undefined || Number.isNaN(ref) ? undefined : errorRefs.get(ref)?.deref();
  return original && original.code === code ? original : solError(code as SolErrorCode, message);
}

export const wellFormed = (s: string): boolean => (s as string & { isWellFormed(): boolean }).isWellFormed();

/** A number or error as the core's cell reader takes it: non-finite numbers and errors tagged. */
export function wireCell(v: unknown): unknown {
  if (typeof v === "number" && !Number.isFinite(v)) return { __nf: Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf" };
  if (typeof v === "number" && Object.is(v, -0)) return { __nf: "-0" };
  if (isSolError(v)) { const ref = errorRef(v); return { __err: v.code, msg: v.message, ...(ref === undefined ? {} : { ref }) }; }
  return v;
}

/** A value as the core reads it: arrays nest, a wired LAMBDA crosses as its body text and captures, and with `units` a
 *  value with a unit crosses as itself ([[C25]] firstClassUnits). Undefined where a value can't cross: a LAMBDA with no
 *  text, a frame or other object, text with a lone surrogate, a unit where `units` is off. */
export function coreValue(v: unknown, units = false): unknown {
  if (v === undefined) return { __undef: 1 };
  if (typeof v === "string") return wellFormed(v) ? v : undefined;
  if (units && isUnitCell(v)) {
    const udim = v.display ? displayDim(v.display) : null;
    const shown = v.display ? { scale: wireCell(displayScale(v.display)), offset: wireCell(displayOffset(v.display)), udim: udim && Object.fromEntries(Object.entries(udim).map(([k, x]) => [k, wireCell(x)])) } : {};
    return { __unit: { value: wireCell(v.value), dim: v.dim, ...(v.display === undefined ? {} : { display: v.display }), ...(v.ratio ? { ratio: true } : {}), ...shown } };
  }
  if (Array.isArray(v)) {
    const out = v.map((x) => coreValue(x, units));
    return out.includes(undefined) ? undefined : out;
  }
  if (isCx(v)) return { __cx: [wireCell(v.re), wireCell(v.im)] };
  if (isLambdaValue(v)) {
    if (v.eta) return { __lambda: { eta: v.expr } };
    if (!v.expr || !wellFormed(v.expr)) return undefined;
    const values = (v.captured ?? []).map((_, i) => coreValue(v.capturedValues?.[i]));
    return values.includes(undefined) ? undefined : { __lambda: { params: v.params, expr: v.expr, captured: v.captured ?? [], capturedValues: values } };
  }
  if (v === null || typeof v === "number" || typeof v === "boolean" || isSolError(v)) return wireCell(v);
  return undefined;
}

const fromBits = (b: string): number => {
  const d = new DataView(new ArrayBuffer(8));
  d.setBigUint64(0, BigInt(b));
  return d.getFloat64(0);
};

/** Thrown where a reply holds a value JS can't take back (a LAMBDA inside a list). */
class Uncrossable extends Error {}

function fromReply(r: unknown): unknown {
  if (r === null) return null;
  if (Array.isArray(r)) throw new Uncrossable();
  const o = r as { undef?: true; num?: string; str?: string; bool?: boolean; err?: string; msg?: string; ref?: number; fx?: string; list?: unknown[]; cx?: string[]; lambda?: true;
    unit?: { value: string; dim: [string, string][]; display: string | null; ratio: boolean } };
  if (o.num !== undefined) return fromBits(o.num);
  if (o.str !== undefined) return o.str;
  if (o.bool !== undefined) return o.bool;
  if (o.err !== undefined) return errorFromCore(o.err, o.msg ?? "", o.ref);
  if (o.list) return o.list.map(fromReply);
  if (o.undef) return undefined;
  if (o.fx !== undefined) return new Error(o.fx);
  if (o.cx) return cx(fromBits(o.cx[0]), fromBits(o.cx[1]));
  if (o.unit) {
    const u = o.unit;
    const dim = Object.fromEntries(u.dim.map(([k, b]) => [k, fromBits(b)]));
    return { __unitCell: true, value: fromBits(u.value), dim, ...(u.display === null ? {} : { display: u.display }), ...(u.ratio ? { ratio: true } : {}) } satisfies UnitCell;
  }
  throw new Uncrossable();
}

/** The core's answer as a JS value, or `{ none }` where it bailed or answered something JS can't take back. */
export function readReply(r: unknown): { value: unknown } | null {
  const o = r as { bail?: boolean; thrown?: string } | null;
  if (o && typeof o === "object" && (o.bail || o.thrown !== undefined)) return null;
  try {
    return { value: fromReply(r) };
  } catch (e) {
    if (e instanceof Uncrossable) return null;
    throw e;
  }
}

// ─── Running on the core ─────────────────────────────────────────────────────────

export function wasmEngineOn(): boolean {
  return settingsStore.get("wasmEngine") !== false;
}

/** The moment a row formula reads, lowered once per calc ([[D46]] freezeVolatilePerCalc): NOW as the TS reads it
 *  (TODAY is its day). The core reads the local zone itself. */
export interface EngineClock { now: number }

export function engineClock(at: Date = new Date()): EngineClock {
  return { now: wallClockSerial(at) };
}

/** `compileEvaluator(src)(env)` on the core, or null where the wasm engine is off, a value can't cross, or the core
 *  leaves a reading to the TS. */
let externalGen = -1;
onWasmEngineReset(() => { externalGen = -1; });

/** Tells the core which names the TS registry holds, once per registry change: a pack's function, registered in JS
 *  at run time, is called back on the TS rather than answered #NAME?. */
export function syncExternalNames(): void {
  const gen = registryGeneration();
  if (gen === externalGen) return;
  wasmInvokeSync("engine_external_names", { names: internalFunctionNames() });
  externalGen = gen;
}

// A long list crossing again and again (a wired LAMBDA's capture, its body called once per item) is sent once: the
// core holds it under an id for as long as the JS list lives, which is what makes a list's identity its content
// ([[C120]] linearWork). Ids only grow, so one a dead instance held never names another list.
const HELD_FROM = 64;
let heldIds = new WeakMap<object, number>();
let heldSeq = 0;
const forgotten: number[] = [];
const heldGone = typeof FinalizationRegistry !== "undefined" ? new FinalizationRegistry<number>((id) => forgotten.push(id)) : null;
onWasmEngineReset(() => { heldIds = new WeakMap(); });

function envValue(v: unknown): unknown {
  if (!heldGone || !Array.isArray(v) || v.length < HELD_FROM) return coreValue(v);
  const id = heldIds.get(v);
  if (id !== undefined) return { __ref: id };
  const w = coreValue(v);
  if (w === undefined) return undefined;
  heldIds.set(v, ++heldSeq);
  heldGone.register(v, heldSeq);
  return { __def: heldSeq, v: w };
}

export function evaluateOnCore(src: string, env: Record<string, unknown>): { value: unknown } | null {
  return onCore(() => {
    if (!wasmEngineLoaded() || !wasmEngineOn() || !wellFormed(src)) return null;
    if (forgotten.length) wasmInvokeSync("engine_forget", { ids: forgotten.splice(0) });
    const wire: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
      const w = envValue(v);
      if (w === undefined) return null;
      wire[k] = w;
    }
    syncExternalNames();
    return readReply(wasmInvokeSync<unknown>("engine_eval", { src, env: wire, clock: engineClock() }));
  }, null);
}

/** Expression's unit wrapper over its read inputs on the core ([[C25]] firstClassUnits, `unit_expression.rs`), or null
 *  where the wasm engine is off, a value can't cross, or the core leaves it to the TS. */
export function expressionUnitsOnCore(src: string, env: Record<string, unknown>): { value: unknown } | null {
  return onCore(() => {
    if (!wasmEngineLoaded() || !wasmEngineOn() || !wellFormed(src)) return null;
    const wire: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
      const w = coreValue(v, true);
      if (w === undefined) return null;
      wire[k] = w;
    }
    syncExternalNames();
    return readReply(wasmInvokeSync<unknown>("engine_expression_units", { src, env: wire, order: Object.keys(env), clock: engineClock() }));
  }, null);
}

// A card mapping one body over a list crosses once for the list, not once an item ([[C120]] linearWork): `coreEach`
// runs the item loop twice, first recording each `callCore` (which answers a placeholder), then sending each body's
// calls in one `engine_call_each` and answering the second run's calls from the replies. A call the second run makes
// differently from the first, or one the batch couldn't answer, goes through `callCore` as ever, so the answers are
// the per-call ones. The loop must not keep what a call answers beyond the item (a cache would keep the placeholder).
interface Recorded { name: string; args: readonly unknown[]; answer?: { value: unknown } }
const PENDING = Object.freeze({ pendingCoreCall: true });
let recording: Recorded[] | null = null;
let replaying: { calls: Recorded[]; at: number } | null = null;
const EACH_FROM = 8;

export function coreEach<R>(n: number, item: (i: number) => R): R[] {
  const out: R[] = new Array(n);
  if (n >= EACH_FROM && !recording && !replaying && wasmEngineLoaded() && wasmEngineOn()) {
    const calls: Recorded[] = [];
    recording = calls;
    try {
      for (let i = 0; i < n; i++) item(i);
    } catch {
      calls.length = 0;
    } finally {
      recording = null;
    }
    answerEach(calls);
    replaying = { calls, at: 0 };
    try {
      for (let i = 0; i < n; i++) out[i] = item(i);
    } finally {
      replaying = null;
    }
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = item(i);
  return out;
}

/** Answers the recorded calls body by body, one `engine_call_each` each over the argument positions that vary. */
function answerEach(calls: Recorded[]): void {
  const groups = new Map<string, Recorded[]>();
  for (const c of calls) {
    const key = `${c.args.length}:${c.name}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const first = g[0].args;
    const at = first.map((_, p) => p).filter((p) => g.some((c) => !Object.is(c.args[p], first[p])));
    const args = first.map((a, p) => (at.includes(p) ? null : coreValue(a, true)));
    if (args.includes(undefined)) continue;
    const sent: Recorded[] = [];
    const items: unknown[][] = [];
    for (const c of g) {
      const item = at.map((p) => coreValue(c.args[p], true));
      if (item.includes(undefined)) continue;
      sent.push(c);
      items.push(item);
    }
    if (sent.length < 2) continue;
    const r = onCore(() => {
      syncExternalNames();
      return wasmInvokeSync<{ each?: unknown[] }>("engine_call_each", { name: g[0].name, args, at, items, clock: engineClock(), scan: true });
    }, null);
    r?.each?.forEach((v, k) => {
      const a = typeof v === "number" ? { value: v } : readReply(v);
      if (a) sent[k].answer = { value: normalizeFxResult(a.value) };
    });
  }
}

/** A function body (`resolveExcelFunction(name)(...args)`, as `dispatch` calls it) on the core, so a node computes what
 *  its formula does in the one implementation ([[C17]] shareImpl, [[D99]] rustIsSpec). It runs on the TS where the
 *  core isn't loaded, an argument can't cross, or the core leaves the reading to the TS. An error argument and a Formula.js
 *  error answer read as the evaluator reads them (`argumentError`). */
export function callCore(name: string, args: readonly unknown[]): unknown {
  if (recording) {
    recording.push({ name, args });
    return PENDING;
  }
  if (replaying) {
    const r = replaying.calls[replaying.at];
    if (r && r.name === name && r.args.length === args.length && r.args.every((a, i) => Object.is(a, args[i]))) {
      replaying.at++;
      if (r.answer) return r.answer.value;
    } else replaying.at = Infinity;
  }
  if (wasmEngineLoaded() && wasmEngineOn()) {
    const wire = args.map((a) => coreValue(a, true));
    if (!wire.includes(undefined)) {
      const r = onCore(() => {
        syncExternalNames();
        return readReply(wasmInvokeSync<unknown>("engine_call", { name, args: wire, clock: engineClock(), scan: true }));
      }, null);
      if (r) return normalizeFxResult(r.value);
    }
  }
  const f = resolveExcelFunction(name);
  if (!f) return solError("#NAME?", `Unknown function ${name}`);
  const early = argumentError(name.toUpperCase(), args);
  if (early) return early;
  try {
    return normalizeFxResult(f(...args));
  } catch (e) {
    if (isSolError(e)) return e;
    if (e instanceof TypeError || e instanceof RangeError) return solError("#VALUE!", `${name} can't compute with these arguments`);
    throw e;
  }
}

/** `dimEvalWithCode` of a formula on the core ([[C25]] firstClassUnits, [[D99]] rustIsSpec): `{ dim, code }`, a
 *  #UNIT! conflict, or null where it is indeterminate. Undefined where the core is off or the formula doesn't parse. */
export function dimEvalOnCore(src: string, env: Record<string, Record<string, number>>, codes: Record<string, string>):
  { dim: Record<string, number>; code?: string } | SolError | null | undefined {
  return onCore(() => {
    if (!wasmEngineLoaded() || !wasmEngineOn() || !wellFormed(src)) return undefined;
    const r = wasmInvokeSync<{ parses?: false; dim?: [string, string][]; code?: string | null; indeterminate?: true; err?: string; msg?: string }>(
      "engine_dim_eval", { src, env, codes });
    if (r.parses === false) return undefined;
    if (r.indeterminate) return null;
    if (r.err !== undefined) return solError(r.err as SolErrorCode, r.msg ?? "");
    const dim = Object.fromEntries(r.dim!.map(([k, v]) => [k, Number(v)]));
    return r.code == null ? { dim } : { dim, code: r.code };
  }, undefined);
}

/** `affineWeight` of a formula on the core: 1 a reading, 0 a difference, or #UNIT!. Undefined where the core is off or
 *  the formula doesn't parse. `fns` are named LAMBDAs as their parameters and body text. */
export function affineWeightOnCore(src: string, points: readonly string[], lists: readonly string[], bare: readonly string[],
  fns: Record<string, [string[], string]>): 0 | 1 | SolError | undefined {
  return onCore(() => {
    if (!wasmEngineLoaded() || !wasmEngineOn() || !wellFormed(src) || !Object.values(fns).every(([, b]) => wellFormed(b))) return undefined;
    const r = wasmInvokeSync<{ parses?: false; w?: 0 | 1; err?: string; msg?: string }>("engine_affine_weight", { src, points, lists, bare, fns });
    if (r.parses === false) return undefined;
    return r.err !== undefined ? solError(r.err as SolErrorCode, r.msg ?? "") : r.w!;
  }, undefined);
}
