// [[C130]] rustCore, [[D99]] rustIsSpec
// Values across the boundary with the Rust core: what a JS value looks like to `eval.rs` `decode_value`, what the
// core's reply (`frame_backend.rs` `call_reply`) looks like back, and the table that lets an error cell come back as
// the very SolError that went in.
import { solError, isSolError, type SolError, type SolErrorCode, type SolErrorOrigin } from "./errorValue";
import { isCx, cx } from "./cxValue";
import { isLambdaValue } from "./lambdaValue";
import { isUnitCell, displayScale, displayOffset, displayDim, type UnitCell } from "./unitValue";
import { wallClockSerial } from "./nodes/dateSerial";
import { wasmInvokeSync, onCore, onWasmEngineReset } from "./engineWasm";

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

/** The error that went in under `ref`, if it is still alive and still this code; else a fresh one, with the origin the
 *  core kept for it. */
export function errorFromCore(code: string, message: string, ref: number | undefined, origin?: SolErrorOrigin): SolError {
  const original = ref === undefined || Number.isNaN(ref) ? undefined : errorRefs.get(ref)?.deref();
  if (original && original.code === code) return original;
  const e = solError(code as SolErrorCode, message);
  return origin ? { ...e, origin } : e;
}

/** Text as the core holds it: a lone surrogate reads as U+FFFD ([[rust-core]] § Follow-ups, text is always well formed). */
export const toWellFormed = (s: string): string => (s as string & { toWellFormed(): string }).toWellFormed();

/** A number or error as the core's cell reader takes it: non-finite numbers and errors tagged. */
export function wireCell(v: unknown): unknown {
  if (typeof v === "number" && !Number.isFinite(v)) return { __nf: Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf" };
  if (typeof v === "number" && Object.is(v, -0)) return { __nf: "-0" };
  if (isSolError(v)) { const ref = errorRef(v); return { __err: v.code, msg: v.message, ...(ref === undefined ? {} : { ref }), ...(v.origin ? { origin: v.origin } : {}) }; }
  return v;
}

/** A value as the core reads it: arrays nest, a wired LAMBDA crosses as its body text and captures (theirs with their
 *  units whatever `units` says), and with `units` a value with a unit crosses as itself ([[C25]] firstClassUnits).
 *  Undefined where a value can't cross: a LAMBDA with no text, a frame or other object, a unit where `units` is off. */
export function coreValue(v: unknown, units = false): unknown {
  if (v === undefined) return { __undef: 1 };
  if (typeof v === "string") return toWellFormed(v);
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
    if (!v.expr) return undefined;
    const captured = v.captured ?? [];
    // The captures with their units, beside the values the body reads for them (the shown numbers, or a plan's magnitudes).
    const values = captured.map((_, i) => coreValue(v.capturedValues?.[i], true));
    const read = captured.map((_, i) => coreValue((v.readValues ?? v.capturedValues)?.[i]));
    if (values.includes(undefined) || read.includes(undefined)) return undefined;
    const d = v.descriptions;
    const descriptions = d ? { descriptions: Object.fromEntries(Object.entries(d).map(([k, x]) => [toWellFormed(k), toWellFormed(x)])) } : {};
    return { __lambda: { params: v.params.map(toWellFormed), expr: toWellFormed(v.expr), captured: captured.map(toWellFormed), capturedValues: values, readValues: read, ...descriptions } };
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
  if (typeof r === "number") return r;
  if (Array.isArray(r)) throw new Uncrossable();
  const o = r as { undef?: true; num?: string; str?: string; bool?: boolean; err?: string; msg?: string; ref?: number; origin?: SolErrorOrigin; fx?: string; list?: unknown[]; cx?: string[]; lambda?: true;
    unit?: { value: string; dim: [string, string][]; display: string | null; ratio: boolean } };
  if (o.num !== undefined) return fromBits(o.num);
  if (o.str !== undefined) return o.str;
  if (o.bool !== undefined) return o.bool;
  if (o.err !== undefined) return errorFromCore(o.err, o.msg ?? "", o.ref, o.origin);
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

/** The core's answer as a JS value, or null where it threw or answered something JS can't take back. */
export function readReply(r: unknown): { value: unknown } | null {
  const o = r as { thrown?: string } | null;
  if (o && typeof o === "object" && o.thrown !== undefined) return null;
  try {
    return { value: fromReply(r) };
  } catch (e) {
    if (e instanceof Uncrossable) return null;
    throw e;
  }
}

// ─── Running on the core ─────────────────────────────────────────────────────────

/** The moment a row formula reads, lowered once per calc ([[C23]] calcModes): NOW as the TS reads it
 *  (TODAY is its day). The core reads the local zone itself. */
export interface EngineClock { now: number }

export function engineClock(at: Date = new Date()): EngineClock {
  return { now: wallClockSerial(at) };
}

/** What a call answers where the core trapped mid-call; a fresh instance is on its way ([[rust-core]] § Where it runs). */
export const TRAPPED_MESSAGE = "The engine stopped while computing this; it restarted, so recalculate to try again";

const FX_CODE: Record<string, SolErrorCode> = {
  "#DIV/0!": "#DIV/0!", "#N/A": "#N/A", "#NAME?": "#NAME?",
  "#REF!": "#REF!", "#VALUE!": "#VALUE!", "#NULL!": "#VALUE!", "#NUM!": "#DOMAIN!",
};

/** An Excel error answer (`{fx}`, `#NUM!`) as the error a formula shows. */
export function fxErrorToSol(e: Error): SolError {
  const code = /#[A-Z0-9/?!.]+/.exec(e.message || String(e))?.[0] ?? "";
  return solError(FX_CODE[code] ?? "#VALUE!", "The formula produced an error");
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

/** A function body over plain arguments on the core, as a formula's call reads them; a JavaScript exception or a
 *  trap answers an error value. */
export function callOnCore(name: string, args: readonly unknown[]): unknown {
  const wire = args.map((a) => coreValue(a));
  if (wire.includes(undefined)) return solError("#VALUE!", `${name} got a value it can't read`);
  const r = onCore(() => readReply(wasmInvokeSync<unknown>("engine_call", { name, args: wire, clock: engineClock(), scan: true })), null);
  if (!r) return solError("#VALUE!", `${name} can't compute with these arguments`);
  return r.value instanceof Error ? fxErrorToSol(r.value) : r.value;
}

/** `compileEvaluator(src)(env)`: the formula over named values on the core. A JavaScript exception the core reports
 *  is thrown, as the formula threw it; a trap answers an error value. */
export function evaluateOnCore(src: string, env: Record<string, unknown>): unknown {
  return onCore(() => {
    if (forgotten.length) wasmInvokeSync("engine_forget", { ids: forgotten.splice(0) });
    const send = () => {
      const wire: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(env)) {
        const w = envValue(v);
        if (w === undefined) return solError("#VALUE!", `${k} holds a value a formula can't read`);
        wire[k] = w;
      }
      return wasmInvokeSync<unknown>("engine_eval", { src: toWellFormed(src), env: wire, clock: engineClock() });
    };
    let r = send();
    // The core lost a list it held (a fresh instance after a trap): send every list whole again.
    if ((r as { missing?: true } | null)?.missing) {
      heldIds = new WeakMap();
      r = send();
    }
    if (isSolError(r)) return r;
    const thrown = (r as { thrown?: string } | null)?.thrown;
    if (thrown !== undefined) throw new Error(thrown);
    const v = readReply(r);
    if (!v) return solError("#VALUE!", "This answer can't come back from the engine");
    return v.value instanceof Error ? fxErrorToSol(v.value) : v.value;
  }, solError("#ERROR!", TRAPPED_MESSAGE));
}
