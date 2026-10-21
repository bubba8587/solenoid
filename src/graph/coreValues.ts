// [[C130]] rustCore, [[D99]] rustIsSpec
// Values across the boundary with the Rust core: what a JS value looks like to `eval.rs` `decode_value`, what the
// core's reply (`frame_backend.rs` `call_reply`) looks like back, and the table that lets an error cell come back as
// the very SolError that went in.
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import { isCx, cx } from "./cxValue";
import { isLambdaValue } from "./lambdaValue";
import { wallClockSerial } from "./nodes/dateSerial";
import { settingsStore } from "./settingsStore";
import { wasmEngineLoaded, wasmInvokeSync } from "./engineWasm";
import { registryGeneration, internalFunctionNames } from "./excelFunctions";

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

/** A value as the core reads it: arrays nest, a wired LAMBDA crosses as its body text and captures. Undefined where
 *  a value can't cross: a LAMBDA with no text, a frame or other object, text with a lone surrogate. */
export function coreValue(v: unknown): unknown {
  if (v === undefined) return { __undef: 1 };
  if (typeof v === "string") return wellFormed(v) ? v : undefined;
  if (Array.isArray(v)) {
    const out = v.map(coreValue);
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
  const o = r as { undef?: true; num?: string; str?: string; bool?: boolean; err?: string; msg?: string; ref?: number; fx?: string; list?: unknown[]; cx?: string[]; lambda?: true };
  if (o.num !== undefined) return fromBits(o.num);
  if (o.str !== undefined) return o.str;
  if (o.bool !== undefined) return o.bool;
  if (o.err !== undefined) return errorFromCore(o.err, o.msg ?? "", o.ref);
  if (o.list) return o.list.map(fromReply);
  if (o.undef) return undefined;
  if (o.fx !== undefined) return new Error(o.fx);
  if (o.cx) return cx(fromBits(o.cx[0]), fromBits(o.cx[1]));
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

/** The local time a row formula reads, lowered once per calc ([[D46]] freezeVolatilePerCalc): TODAY and NOW as the
 *  TS reads them now, and whether a day built at local midnight rounds back to its own serial (EDATE's
 *  `toSerialIfDate`), true where every local offset lies in (−11 h, +12 h]. East of UTC, day 0 rounds up from below
 *  to −0 (`dayZeroNegative`). */
export interface EngineClock { now: number; today: number; midnightRounds: boolean; dayZeroNegative: boolean }

let localZone: { zone: string; midnightRounds: boolean; dayZeroNegative: boolean } | null = null;

function localZoneFacts(): { midnightRounds: boolean; dayZeroNegative: boolean } {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  if (localZone?.zone !== zone) {
    // Twice a month over 1700–2100: a zone's offset is constant before its first transition and its DST rule repeats after 2037.
    let ok = true;
    for (let y = 1700; y <= 2100 && ok; y++) {
      for (let m = 0; m < 24 && ok; m++) {
        const tzo = new Date(y, m >> 1, m % 2 === 0 ? 1 : 16).getTimezoneOffset();
        ok = tzo >= -720 && tzo < 660;
      }
    }
    const dayZero = Math.round(new Date(1899, 11, 30).getTime() / 86400000 + 25569);
    localZone = { zone, midnightRounds: ok, dayZeroNegative: Object.is(dayZero, -0) };
  }
  return localZone;
}

export function engineClock(at: Date = new Date()): EngineClock {
  const { midnightRounds, dayZeroNegative } = localZoneFacts();
  return { now: wallClockSerial(at), today: wallClockSerial(at, true), midnightRounds, dayZeroNegative };
}

/** `compileEvaluator(src)(env)` on the core, or null where the wasm engine is off, a value can't cross, or the core
 *  leaves a reading to the TS. */
let externalGen = -1;

/** Tells the core which names the TS registry holds, once per registry change: a pack's function, registered in JS
 *  at run time, is called back on the TS rather than answered #NAME?. */
export function syncExternalNames(): void {
  const gen = registryGeneration();
  if (gen === externalGen) return;
  wasmInvokeSync("engine_external_names", { names: internalFunctionNames() });
  externalGen = gen;
}

export function evaluateOnCore(src: string, env: Record<string, unknown>): { value: unknown } | null {
  if (!wasmEngineLoaded() || !wasmEngineOn() || !wellFormed(src)) return null;
  const wire: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env)) {
    const w = coreValue(v);
    if (w === undefined) return null;
    wire[k] = w;
  }
  syncExternalNames();
  return readReply(wasmInvokeSync<unknown>("engine_eval", { src, env: wire, clock: engineClock() }));
}
