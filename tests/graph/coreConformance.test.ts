// [[C130]] rustCore, [[D99]] rustIsSpec
// The Rust core against frozen answers (coreFixtures.ts). FREEZE_CORE=1 regenerates every suite from the TypeScript,
// which only works while that TypeScript exists; after that the fixtures are the spec, and one changes only in the
// commit that changes the behaviour. A function the core doesn't carry yet is skipped, not failed.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { isSolError, solError } from "../../src/graph/errorValue";
import { isCx } from "../../src/graph/cxValue";
import { resolveExcelFunction, FX_FUNCTION_NAMES, internalFunctionNames } from "../../src/graph/excelFunctions";
import { compileTsEvaluator, extractVariables, rowRefNames, parseFormula } from "../../src/graph/excelFormula";
import { dimEvalWithCode, affineWeight, type Lam } from "../../src/graph/unitDimExpr";
import { computeColumnCells } from "../../src/graph/computedColumnCore";
import {
  applyVerb, joinFrames, appendFrames, bindColumns, promoteHeaders, demoteHeaders, describeFrame, correlationMatrix, reconcileFrames,
  reconcileSummaryList, nestGroups, lookupRowIndex, lookupCell, frameRowAt, decisionMatrix, decisionCriteria, resolveDecisionWeights,
  flipPoints, allocateFrame, type FrameOp, type JoinOpts, type CorrMethod, type LookupMatchMode, type LookupSearchMode, type DecisionNormalize,
} from "../../src/graph/frameVerbs";
import {
  frameToCube, getColumn, addColumn, splitFrame, buildFrame, buildFrameTyped, frameFromLists,
  type FrameValue, type FrameCell, type FrameColType, type FrameColumn, type CubeCell,
} from "../../src/graph/frame";
import { tagFrameCellUnit } from "../../src/graph/unitColumn";
import { isUnitCell, type ColumnUnit, type UnitCell } from "../../src/graph/unitValue";
import { coreValue, readReply, syncExternalNames } from "../../src/graph/coreValues";
import { initPackFormulas } from "../../src/graph/formulaExtensions";
import type { AllocateMode } from "../../src/graph/nodes/allocateOps";
import type { PayoffOrder } from "../../src/graph/nodes/payoffOps";
import { payoffFrame, settleFrame, settleLedgerCube, numericRows, kmeansOutputs, pcaOutputs, logisticOutputs, type PayoffView, type SettleSplit } from "../../src/graph/nodes/frame";
import { amortizationFrame } from "../../src/graph/nodes/finance";
import { frameBackend, useWasmBackend, computeColumnOnEngine, engineClock, frameFnOnCore } from "../../src/graph/frameBackend";
import { LambdaNode } from "../../src/graph/nodes/lambda";
import { ExpressionNode } from "../../src/graph/nodes/expression";
import { isLambdaValue, type LambdaValue } from "../../src/graph/lambdaValue";
import { loadWasmEngineSync, wasmInvokeSync } from "../../src/graph/engineWasm";
import { frozen, FREEZING, enc } from "./coreFixtures";
import {
  mulberry32, gen, FNS, FORMULA_FNS, SORTS_NUMBERS, formulaGen, DIST_CASES, FINANCE_CASES, LEFTOVER_CASES, REGEX_ATOMS, REGEX_CHARS,
  REGEX_ASCII, REGEX_REPL, TEXT_CHARS, TEXT_UTIL_NAMES, POOL, LIST_BODIES, RAW_LISTS, SCHEDULES,
} from "./coreGenerators";

// TODAY and NOW read the clock: one moment, in UTC, both when the cases are made and when they replay.
process.env.TZ = "UTC";
vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 5, 15, 13, 45, 30, 250) });

const WASM = path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm");
let ported = new Set<string>();
beforeAll(() => {
  loadWasmEngineSync(fs.readFileSync(WASM));
  useWasmBackend();
  ported = new Set(wasmInvokeSync<string[]>("engine_ported"));
});

const wf = (t: string) => (t as string & { toWellFormed(): string }).toWellFormed();
const bits = (x: number) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(); };
const isNanBits = (b: string) => (BigInt(b) & 0x7ff0000000000000n) === 0x7ff0000000000000n && (BigInt(b) & 0xfffffffffffffn) !== 0n;
const failed = (name: string) => ({ err: "#VALUE!", msg: `${name} can't compute with these arguments` });

/** An answer as comparable data, the way `dispatch` reads a body: a JavaScript engine failure is #VALUE!. */
function canon(r: unknown): unknown {
  if (r === undefined) return { undef: true };
  if (r === null) return null;
  if (r instanceof Error) return { fx: (/#[A-Z0-9/?!.]+/.exec(r.message) ?? [""])[0] };
  if (isSolError(r)) return { err: r.code, msg: wf(r.message) };
  if (typeof r === "number") return { num: Number.isNaN(r) ? "NaN" : bits(r) };
  if (typeof r === "string") return { str: wf(r) };
  if (typeof r === "boolean") return { bool: r };
  if (Array.isArray(r)) return { list: r.map(canon) };
  if (isCx(r)) return { cx: [r.re, r.im].map((x) => (Number.isNaN(x) ? "NaN" : bits(x))) };
  if (isLambdaValue(r)) return { lambda: true };
  return { other: Object.prototype.toString.call(r) };
}

function tsAnswer(name: string, args: unknown[]): unknown {
  const fn = resolveExcelFunction(name)!;
  try {
    return canon(fn(...args.map((a) => (Array.isArray(a) ? structuredClone(a) : a))));
  } catch (e) {
    if (isSolError(e)) return canon(e);
    if (e instanceof TypeError || e instanceof RangeError) return failed(name);
    return { thrown: (e as Error).message };
  }
}

function engineAnswer(name: string, raw: unknown): unknown {
  const o = raw as { num?: string; cx?: string[]; list?: unknown[]; thrown?: string; msg?: string; err?: string } | null;
  if (o === null || typeof o !== "object") return o;
  if (o.thrown !== undefined) return failed(name);
  if (o.num !== undefined) return { num: isNanBits(o.num) ? "NaN" : o.num };
  if (o.list) return { list: o.list.map((x) => engineAnswer(name, x)) };
  if ((o as { lambda?: boolean }).lambda) return { lambda: true };
  if (o.cx) return { cx: o.cx.map((b) => (isNanBits(b) ? "NaN" : b)) };
  if (o.err !== undefined) return { err: o.err, msg: wf(o.msg ?? "") };
  return o;
}

const wire = (a: unknown): unknown => (Array.isArray(a) ? a.map(wire) : a === undefined ? { __undef: 1 }
  : typeof a === "number" && !Number.isFinite(a) ? { __nf: Number.isNaN(a) ? "nan" : a > 0 ? "inf" : "-inf" }
  : Object.is(a, -0) ? { __nf: "-0" } : isSolError(a) ? { __err: a.code, msg: a.message } : a);

// ─── Function bodies ──────────────────────────────────────────────────────────────

type FnCase = { name: string; args: unknown[]; want: unknown };
/** Names whose answer depends on the clock or a random draw, or that take a LAMBDA: the evaluator suites cover them. */
const NOT_A_BODY = /^(RAND|RANDBETWEEN|RANDARRAY|RANDDIST|SHUFFLE|UUID|NOW|TODAY|MAP|BYROW|BYCOL|REDUCE|SCAN|MAKEARRAY|LAMBDA|GROUPBY|IFERROR|IFNA|ISERROR|ISERR|ISNA|ERROR\.TYPE|ROW)$/;
const PER_NAME = 200;

function bodyCases(): FnCase[] {
  const cases: FnCase[] = [];
  const add = (name: string, args: unknown[]) => {
    const t = performance.now();
    const want = tsAnswer(name, args);
    // A case that takes the TypeScript this long is a loop test, which the hang sweep owns.
    if (performance.now() - t > 1000 || JSON.stringify(want).includes('"other"')) return;
    cases.push({ name, args, want });
  };
  const everything = [...new Set([...FX_FUNCTION_NAMES, ...internalFunctionNames()])].filter((n) => !NOT_A_BODY.test(n) && resolveExcelFunction(n)).sort();
  const fns = new Set(FNS);
  for (const name of everything) {
    const rand = mulberry32(77 + name.length * 1000 + name.charCodeAt(0));
    const one = () => POOL[Math.floor(rand() * POOL.length)];
    const known = fns.has(name);
    const list = () => Array.from({ length: Math.floor(rand() * 7) }, one)
      .filter((v) => (RAW_LISTS.has(name) || !known ? v !== undefined : v != null && !isSolError(v) && !Number.isNaN(v)));
    const numbers = () => Array.from({ length: 1 + Math.floor(rand() * 6) }, () => Math.round((rand() * 40 - 20) * 4) / 4);
    const matrix = () => { const w = 1 + Math.floor(rand() * 3); return Array.from({ length: 1 + Math.floor(rand() * 3) }, () => Array.from({ length: w }, () => (rand() < 0.8 ? Math.round(rand() * 20 - 5) : one()))); };
    for (let i = 0; i < PER_NAME; i++) {
      const arg = () => {
        if (known) return LIST_BODIES.has(name) && rand() < 0.5 ? list() : one();
        const r = rand();
        return r < 0.45 ? one() : r < 0.65 ? numbers() : r < 0.8 ? list() : matrix();
      };
      const args = Array.from({ length: Math.floor(rand() * 5) }, arg);
      if (name === "SWITCH" && args.some(isSolError)) continue;
      if (name === "BINOM.INV" && Math.abs(Number(args[0])) > 1e4) continue;
      if (/^(ROMAN|BASE|DEC2|HEX2|OCT2|BIN2)/.test(name) && args.some((a) => Math.abs(Number(a)) > 1e7 && Number.isFinite(Number(a)))) continue;
      if (SCHEDULES.test(name) && Math.max(...args.map((a) => Math.abs(Number(a)) || 0)) > 1e5) continue;
      add(name, args);
    }
  }
  for (const [label, table, n] of [["dist", DIST_CASES, PER_NAME], ["finance", FINANCE_CASES, PER_NAME], ["leftover", LEFTOVER_CASES, PER_NAME]] as const) {
    for (const [name, g] of table) {
      if (NOT_A_BODY.test(name)) continue;
      const rand = mulberry32(8080 + label.length + name.length * 31 + name.charCodeAt(0));
      for (let i = 0; i < n; i++) {
        const args = g(rand);
        while (args.length && args[args.length - 1] === undefined) args.pop();
        add(name, args);
      }
    }
  }
  const rand = mulberry32(31337);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  for (let i = 0; i < 3000; i++) {
    const r = rand();
    const x = r < 0.4 ? (Math.floor(rand() * 1e6) + 0.5) / 2 ** Math.floor(rand() * 12) * (rand() < 0.5 ? -1 : 1)
      : r < 0.7 ? (rand() - 0.5) * 10 ** Math.floor(rand() * 40 - 20) : Math.round(rand() * 1e9) / 1000;
    const d = Math.floor(rand() * 12);
    add("TEXT", [x, rand() < 0.5 ? `#,##0${d ? "." + "0".repeat(d) : ""}` : `0${d ? "." + "0".repeat(d) : ""}E+00`]);
  }
  for (let i = 0; i < 3000; i++) {
    const d = Math.floor(rand() * 8) - 2, r = rand();
    const base = Math.floor(rand() * 1e6) + (r < 0.3 ? 0.5 : r < 0.5 ? 0.5 + (rand() - 0.5) * 1e-12 : r < 0.7 ? (rand() - 0.5) * 1e-12 : rand());
    const v = (base / 10 ** d) * (rand() < 0.5 ? -1 : 1);
    for (const name of ["ROUND", "ROUNDUP", "ROUNDDOWN"]) add(name, [v, d]);
  }
  for (let i = 0; i < 2000; i++) {
    const d = Math.floor(rand() * 14) - 4;
    add("FIXED", [((Math.floor(rand() * 1e7) + (rand() < 0.4 ? 0.5 : rand())) / 10 ** Math.floor(rand() * 8)) * (rand() < 0.5 ? -1 : 1), d, rand() < 0.3]);
  }
  for (let i = 0; i < 3000; i++) {
    const k = Math.floor(rand() * 12) - 2, r = rand();
    const base = r < 0.3 ? Math.floor(rand() * 1e7) + 0.5 : r < 0.45 ? Math.floor(rand() * 1e7) + 0.5 + (rand() - 0.5) * 1e-9
      : r < 0.6 ? 10 ** (rand() * 300) * (rand() + 0.5) : r < 0.7 ? 10 ** (-rand() * 300) : r < 0.75 ? 2 ** 53 + Math.floor(rand() * 1e6) * 2 : rand() * 1e4;
    const v = r > 0.97 ? pick(["12.345", "abc", "", true, null, NaN, Infinity, -Infinity, -0, solError("#N/A", "x")]) : (base / 10 ** k) * (rand() < 0.5 ? -1 : 1);
    const d = rand() < 0.85 ? Math.floor(rand() * 18) - 4 : pick([undefined, null, "2", " 3 ", "x", "", true, 2.5, -1.5, 20, 100, 100.5, 101, 1e21, NaN]);
    add("DOLLAR", d === undefined ? [v] : [v, d]);
  }
  const run = (n: number, xs: readonly string[]) => Array.from({ length: n }, () => pick(xs)).join("");
  for (let i = 0; i < 3000; i++) {
    const pat = run(1 + Math.floor(rand() * 6), REGEX_ATOMS);
    const text = run(Math.floor(rand() * 12), rand() < 0.5 ? REGEX_CHARS : REGEX_ASCII);
    const cs = pick([undefined, 0, 1]);
    add("REGEXTEST", [text, pat, cs]);
    add("REGEXEXTRACT", [text, pat, pick([undefined, 0]), cs]);
    add("REGEXREPLACE", [text, pat, run(Math.floor(rand() * 4), REGEX_REPL), pick([undefined, 0, 1, 2, -1, -2, 7, 1.5]), cs]);
  }
  const text = () => Array.from({ length: Math.floor(rand() * 10) }, () => pick(TEXT_CHARS)).join("");
  for (let i = 0; i < 6000; i++) {
    const name = pick(TEXT_UTIL_NAMES);
    let t: unknown = rand() < 0.9 ? text() : pick([null, 12.5, -0.000125, 1e20, true, 123456789012345]);
    if (name === "DECODEBASE64" && rand() < 0.5) t = Buffer.from(text()).toString(pick(["base64", "base64url"])).replace(/=+$/, rand() < 0.5 ? "" : "=");
    if (name === "SPELLNUMBER") t = pick([rand() * 10 ** Math.floor(rand() * 16), -rand() * 1e6, Math.floor(rand() * 1e15), 1e-7 * rand(), "12", "x", null, 0, -0]);
    const extra = name === "HASH" ? [pick(["sha256", "SHA-1", "md5", " CRC_32 ", "fnv1a32", "FNV-1a 64", "blake", "constructor", null])]
      : name === "SLUGIFY" ? [pick([undefined, null, "-", "_", "--", "", "$&", "$$", "a", ".", "x.x"])]
      : name === "TEMPLATE" ? Array.from({ length: Math.floor(rand() * 3) }, () => pick([1.5, "x", null, true, solError("#N/A", "n"), [1, "b"], 45000]))
      : [];
    add(name, [t, ...extra]);
  }
  return cases;
}

const bodies = frozen<FnCase>("function-bodies", bodyCases);
const byName = new Map<string, FnCase[]>();
for (const c of bodies) (byName.get(c.name) ?? byName.set(c.name, []).get(c.name)!).push(c);

/** How many frozen cases each suite may leave to the TS (the core bails on them): a ratchet, so a bail never hides a
 *  regression. CORE_BAILS_WRITE=1 rewrites it from this run; lower numbers are the only edits it should see. */
const BAILS_FILE = path.resolve(__dirname, "../../fixtures/core/bails.json");
const allowedBails: Record<string, number> = fs.existsSync(BAILS_FILE) ? JSON.parse(fs.readFileSync(BAILS_FILE, "utf8")) : {};
const seenBails: Record<string, number> = {};
function checkBails(key: string, bailed: number): void {
  seenBails[key] = bailed;
  if (process.env.CORE_BAILS_WRITE) return;
  expect(bailed, `${key} leaves ${bailed} cases to the TS, past its ${allowedBails[key] ?? 0} (fixtures/core/bails.json)`).toBeLessThanOrEqual(allowedBails[key] ?? 0);
}
afterAll(() => {
  if (!process.env.CORE_BAILS_WRITE) return;
  const merged = { ...allowedBails, ...seenBails };
  const out = Object.fromEntries(Object.keys(merged).sort().filter((k) => merged[k] > 0).map((k) => [k, merged[k]]));
  fs.writeFileSync(BAILS_FILE, JSON.stringify(out, null, 1) + "\n");
});

describe("function bodies answer as frozen", () => {
  for (const [name, cases] of [...byName].sort(([a], [b]) => (a < b ? -1 : 1))) {
    it(`${name} (${cases.length})`, ({ skip }) => {
      if (!ported.has(name)) skip(`${name} isn't in the core yet`);
      let ran = 0;
      for (const c of cases) {
        const raw = wasmInvokeSync<{ bail?: boolean } | null>("engine_call", { name, args: c.args.map(wire), clock: engineClock() });
        if (raw && raw.bail) continue;
        ran++;
        const got = engineAnswer(name, raw);
        if (JSON.stringify(got) !== JSON.stringify(c.want)) expect({ name, args: c.args, got }).toEqual({ name, args: c.args, got: c.want });
      }
      checkBails(name, cases.length - ran);
    });
  }
});

// ─── V8's Math ────────────────────────────────────────────────────────────────────

type MathCase = { fn: string; xs: number[]; ys: number[]; want: string[] };
const MATH_FNS = ["exp", "log", "log10", "pow", "sin", "cos", "tan", "asin", "acos", "atan", "acosh", "atanh", "log1p", "atan2", "expm1", "tanh", "log2", "prec15"];

/** V8's Math outlives the TypeScript, so these answers are made fresh each run rather than frozen. */
const maths: MathCase[] = MATH_FNS.map((fn) => {
  const rand = mulberry32(31337 + fn.length);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < 20000; i++) {
    const nice = rand() < 0.5;
    const x = fn === "prec15" ? (rand() < 0.3 ? (Math.floor(rand() * 1e15) * 10 + 5) / 2 ** Math.floor(rand() * 8) : (rand() - 0.5) * 10 ** Math.floor(rand() * 40 - 20))
      : fn === "asin" || fn === "acos" || fn === "atanh" ? (nice ? Math.round(rand() * 200 - 100) / 100 : rand() * 2 - 1)
      : fn === "acosh" ? 1 + (nice ? Math.round(rand() * 1e4) / 100 : 10 ** (rand() * 12 - 6))
      : fn === "log1p" ? (nice ? Math.round(rand() * 1e4) / 100 - 0.99 : 10 ** (rand() * 20 - 10) - 0.5)
      : ["sin", "cos", "tan", "atan", "atan2"].includes(fn) ? (nice ? Math.round(rand() * 1e5) / 100 - 500 : (rand() - 0.5) * 10 ** Math.floor(rand() * 40 - 10))
      : fn === "exp" ? (nice ? Math.round(rand() * 1400 - 700) / 4 : rand() * 1400 - 700)
      : fn === "expm1" || fn === "tanh" ? (nice ? Math.round(rand() * 1600 - 800) / 8 : (rand() - 0.5) * 10 ** Math.floor(rand() * 24 - 20))
      : fn === "pow" ? (nice ? Math.round(rand() * 400) / 10 : rand() * 50)
      : (nice ? Math.round(rand() * 1e4) / 8 : Math.exp(rand() * 300 - 150));
    xs.push(x + 0);
    ys.push((nice ? Math.round(rand() * 60 - 30) / 2 : rand() * 60 - 30) + 0);
  }
  const m = { exp: Math.exp, log: Math.log, log10: Math.log10, pow: Math.pow, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin,
    acos: Math.acos, atan: Math.atan, acosh: Math.acosh, atanh: Math.atanh, log1p: Math.log1p, atan2: Math.atan2, expm1: Math.expm1,
    tanh: Math.tanh, log2: Math.log2, prec15: (x: number) => Number(x.toPrecision(15)) }[fn as "exp"] as (a: number, b?: number) => number;
  return { fn, xs, ys, want: xs.map((x, i) => { const r = m(x, ys[i]); return Number.isNaN(r) ? "NaN" : bits(r); }) };
});

describe("the core's Math answers as V8's, bit for bit", () => {
  it.each(maths.map((c) => [c.fn, c] as const))("%s", (_fn, c) => {
    const got = wasmInvokeSync<string[]>("engine_math", { fn: c.fn, xs: c.xs, ys: c.ys });
    const bad = c.xs.map((x, i) => [x, c.ys[i], c.want[i], got[i]] as const).filter(([, , w, g]) => (w === "NaN" ? !isNanBits(g) : w !== g));
    expect(bad.slice(0, 3)).toEqual([]);
  });
});

// ─── Computed columns ─────────────────────────────────────────────────────────────

type LamWire = { params: string[]; expr: string; captured: string[]; capturedValues: unknown[] };
type ColCase = { src: string; frame: FrameValue; sides: Record<string, unknown>; reserved?: string[]; bare?: LamWire; lambdas?: Record<string, LamWire>; want: unknown };

const cellView = (cells: readonly unknown[]) => cells.map((v) => (typeof v === "string" ? wf(v) : isSolError(v) ? { ...v, message: wf(v.message) } : v));
const lamWire = (l: LambdaValue): LamWire => ({ params: [...l.params], expr: l.expr, captured: [...(l.captured ?? [])], capturedValues: [...(l.capturedValues ?? [])] });
const lamValue = (w: LamWire): LambdaValue => ({ __lambda: true, params: w.params, expr: w.expr, captured: w.captured, capturedValues: w.capturedValues,
  fn: () => { throw new Error("a frozen LAMBDA has no TypeScript body"); } } as LambdaValue);

function columnCases(): ColCase[] {
  const cases: ColCase[] = [];
  const answer = (f: FrameValue, src: string, sides: Record<string, unknown>, extra: { reserved?: string[]; bare?: LambdaValue; lambdas?: Record<string, LambdaValue> }) => {
    const sideValue = (p: string, kind: "var" | "row") => (extra.lambdas?.[p] ?? (p in sides ? sides[p] : solError("#REF!", kind === "var" ? `No column "${p}"` : `No column "${p}"`)));
    const js = extra.bare
      ? computeColumnCells(f, { kind: "lambda", lam: extra.bare }, { sideValue })
      : computeColumnCells(f, { kind: "expr", evaluator: compileTsEvaluator(src)!, vars: [...new Set([...extractVariables(src), ...Object.keys(extra.lambdas ?? {})])] }, { sideValue, reserved: extra.reserved, rowRefs: rowRefNames(src) });
    return isSolError(js) ? { error: { code: js.code, message: wf(js.message) } } : { cells: cellView(js.cells), sideVars: js.sideVars };
  };
  const push = (f: FrameValue, src: string, sides: Record<string, unknown>, extra: { reserved?: string[]; bare?: LambdaValue; lambdas?: Record<string, LambdaValue> } = {}) => {
    if (!extra.bare && !compileTsEvaluator(src)) return;
    cases.push({ src, frame: f, sides, reserved: extra.reserved, bare: extra.bare && lamWire(extra.bare),
      lambdas: extra.lambdas && Object.fromEntries(Object.entries(extra.lambdas).map(([k, l]) => [k, lamWire(l)])), want: answer(f, src, sides, extra) });
  };
  const randomFrame = (rand: () => number, rows: number, wide: boolean): FrameValue => {
    const cell = (type: FrameColType): FrameCell => {
      const r = rand();
      if (r < 0.1) return null;
      if (r < 0.15) return solError(rand() < 0.5 ? "#N/A" : "#DIV/0!", "fuzz");
      if (type === "number") return r < 0.22 && wide ? [NaN, Infinity, -Infinity, -0, 1e300][Math.floor(rand() * 5)] : Math.round(rand() * 400 - 200) / 8;
      if (type === "string") return ["", "abc", "Abc", " x ", "12", "TRUE", "😀", "é", "true", "a*c", "ab", "xbx"][Math.floor(rand() * 12)];
      if (type === "logical") return rand() < 0.5;
      return 40000 + Math.floor(rand() * 9000);
    };
    return { __frame: true, columns: (["a:number", "b:string", "c:logical", "d:date"] as const).map((s) => {
      const [name, type] = s.split(":") as [string, FrameColType];
      return { name, type, values: Array.from({ length: rows }, () => cell(type)) };
    }) };
  };
  // Random row formulas over every ported function.
  {
    const rand = mulberry32(4242);
    const expr = formulaGen(rand);
    for (let i = 0; i < 9000; i++) {
      const f = randomFrame(rand, Math.floor(rand() * 7), true);
      const src = expr(3);
      if (SORTS_NUMBERS.test(src)) f.columns[0].values = f.columns[0].values.map((v) => (Number.isNaN(v) ? null : v));
      const r = rand();
      const sides = { s1: r < 0.5 ? 2.5 : null, s2: r < 0.7 ? "x" : 7, s3: [1, 2], nope: true };
      push(f, src, sides, { reserved: ["name"] });
    }
  }
  // FILTER, UNIQUE, SORT, SORTBY, TAKE and DROP inside range functions.
  {
    const rand = mulberry32(777);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const col = () => pick(["a", "b", "c", "d", "[a]", "a * 2", "-a", "b & \"x\"", "@a"]);
    const mask = () => pick(["a > 0", "b = @b", "c", "@c", "TRUE", "0", "a <> @a", "d > 44000", "b = \"abc\"", "a", "b", "s1", "c = c"]);
    const count = () => pick(["1", "2", "-1", "-2", "0", "2.5", "\"\"", "\"x\"", "\"2\"", "TRUE", "@a", "99", "-99", "1e309", ""]);
    const data = (depth: number): string => (depth <= 0 || rand() < 0.35 ? col() : shaper(depth - 1));
    const shaper = (depth: number): string => {
      switch (Math.floor(rand() * 6)) {
        case 0: return `FILTER(${data(depth)}, ${mask()}${rand() < 0.3 ? `, ${pick(["0", "\"none\"", "", "@a"])}` : ""})`;
        case 1: return `UNIQUE(${data(depth)}${rand() < 0.5 ? `, ${pick(["FALSE", "TRUE", "", "0", "\"\""])}, ${pick(["FALSE", "TRUE", ""])}` : ""})`;
        case 2: return `SORT(${data(depth)}${rand() < 0.6 ? `, ${pick(["1", "", "2", "0", "1.5"])}, ${pick(["1", "-1", "", "2"])}${rand() < 0.3 ? `, ${pick(["TRUE", "FALSE", "3"])}` : ""}` : ""})`;
        case 3: return `SORTBY(${data(depth)}, ${pick(["a", "b", "d", "c", "1", "-a"])}${rand() < 0.6 ? `, ${pick(["1", "-1", "", "0"])}` : ""}${rand() < 0.3 ? `, ${pick(["b", "a"])}, -1` : ""})`;
        case 4: return `TAKE(${data(depth)}, ${count()}${rand() < 0.3 ? `, ${count()}` : ""})`;
        default: return `DROP(${data(depth)}, ${count()}${rand() < 0.3 ? `, ${count()}` : ""})`;
      }
    };
    const outer = (inner: string) => pick([`SUM(${inner})`, `COUNT(${inner})`, `COUNTA(${inner})`, `AVERAGE(${inner})`, `MAX(${inner})`, `MIN(${inner})`,
      `TEXTJOIN(",", TRUE, ${inner})`, `TEXTJOIN("|", FALSE, ${inner})`, `MEDIAN(${inner})`, `COUNTBLANK(${inner})`, `PRODUCT(${inner})`,
      `SUM(${inner}, 1)`, `@a + SUM(${inner})`, `IFERROR(SUM(${inner}), -1)`, `CONCAT(${inner})`, inner]);
    for (let i = 0; i < 3000; i++) push(randomFrame(rand, Math.floor(rand() * 8), false), outer(shaper(2)), { s1: rand() < 0.5, nope: 1 });
  }
  // Wired LAMBDA columns, bare and called.
  {
    const rand = mulberry32(8080);
    const expr = formulaGen(rand);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let i = 0; i < 3000; i++) {
      const f = randomFrame(rand, Math.floor(rand() * 7), false);
      const body = rand() < 0.5 ? pick(["x * 2 + @a", "IF(x > 0, x, y)", "x & \"-\" & @b", "SUM(a) / x", "a + x", "LEN(x) + s1", "ROUND(x, 1) + y", "@c", "x"]) : expr(2);
      const lam = new LambdaNode({ params: pick(["x", "x, y", "a", "a, b", "", "x, a"]), expr: body }).data({ s1: [2], s2: ["t"], s3: [5], nope: [true] }).result;
      if (!isLambdaValue(lam)) continue;
      if (rand() < 0.4) push(f, "", {}, { bare: lam });
      else push(f, pick(["λ1(@a)", "λ1(@a, 2)", "IF(@c, λ1(@a, @b), 0)", "SUM(a) + λ1(1, 2)", "λ1()", "λ1(@d, @a) & \"x\"", "IFERROR(λ1(@a, 1), -1)"]), {}, { lambdas: { λ1: lam } });
    }
  }
  return cases;
}

const columns = frozen<ColCase>("columns", columnCases);

describe("computed columns answer as frozen", () => {
  it(`${columns.length} formulas`, { timeout: 600_000 }, () => {
    let ran = 0;
    for (const c of columns) {
      const lambdas = c.lambdas && Object.fromEntries(Object.entries(c.lambdas).map(([k, w]) => [k, lamValue(w)]));
      const sideValue = (p: string, kind: "var" | "row") => (p in c.sides ? c.sides[p] : solError("#REF!", kind === "var" ? `No column "${p}"` : `No column "${p}"`));
      const rows = c.frame.columns.reduce((m, col) => Math.max(m, col.values.length), 0);
      const engine = c.bare
        ? computeColumnOnEngine(c.frame, "", rows, { bare: lamValue(c.bare), sideValue })
        : computeColumnOnEngine(c.frame, c.src, rows, { sideValue, reserved: c.reserved, lambdas });
      if (engine === null) continue;
      ran++;
      const got = isSolError(engine) ? { error: { code: engine.code, message: wf(engine.message) } } : { cells: cellView(engine.cells), sideVars: engine.sideVars };
      if (JSON.stringify(got) !== JSON.stringify(c.want)) expect({ src: c.src, frame: c.frame, got }).toEqual({ src: c.src, frame: c.frame, got: c.want });
    }
    checkBails("computed columns", columns.length - ran);
  });
});

// ─── Table verbs ──────────────────────────────────────────────────────────────────

type Outcome = { frame: unknown } | { error: { code: string; message: string } };
type VerbCase = { kind: "unary"; frame: FrameValue; ops: FrameOp[]; want: Outcome } | { kind: "binary"; which: number; l: FrameValue; r: FrameValue; opts: JoinOpts; want: Outcome };

function view(f: FrameValue): unknown {
  return f.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map((v) => (isSolError(v) ? { err: v.code, msg: wf(v.message) } : typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v)) }));
}
const outcome = (run: () => FrameValue): Outcome => {
  try { return { frame: view(run()) }; } catch (e) { return isSolError(e) ? { error: { code: e.code, message: wf(e.message) } } : { error: { code: "thrown", message: String(e) } }; }
};

const verbs = frozen<VerbCase>("verbs", () => {
  const cases: VerbCase[] = [];
  const g = gen(mulberry32(20261021));
  for (let i = 0; i < 6000; i++) {
    const f = g.frame();
    const ops: FrameOp[] = [];
    let shape = f;
    for (let k = g.int(1, 3); k > 0; k--) {
      const op = g.op(shape);
      ops.push(op);
      try { shape = applyVerb(shape, op); } catch { break; }
    }
    cases.push({ kind: "unary", frame: f, ops, want: outcome(() => ops.reduce((acc, op) => applyVerb(acc, op), f)) });
  }
  const h = gen(mulberry32(42));
  for (let i = 0; i < 6000; i++) {
    const l = h.frame(), r = h.frame();
    const which = h.int(0, 2);
    const opts = h.join(l, r);
    cases.push({ kind: "binary", which, l, r, opts, want: outcome(() => (which === 0 ? joinFrames(l, r, opts) : which === 1 ? appendFrames([l, r]) : bindColumns([l, r]))) });
  }
  return cases;
});

describe("table verbs answer as frozen", () => {
  it(`${verbs.length} pipelines, joins, appends and binds`, { timeout: 600_000 }, async () => {
    const be = frameBackend();
    for (const c of verbs) {
      let got: Outcome;
      try {
        if (c.kind === "unary") {
          const h = await be.source(c.frame);
          got = { frame: view((await be.collect(await be.applyMany(h, c.ops)))! as FrameValue) };
        } else {
          const [a, b] = [await be.source(c.l), await be.source(c.r)];
          const out = c.which === 0 ? await be.join(a, b, c.opts) : c.which === 1 ? await be.append([a, b]) : await be.bindColumns([a, b]);
          got = { frame: view((await be.collect(out))! as FrameValue) };
        }
      } catch (e) {
        got = isSolError(e) ? { error: { code: e.code, message: wf(e.message) } } : { error: { code: "thrown", message: String(e) } };
      } finally {
        wasmInvokeSync("engine_clear");
      }
      if (JSON.stringify(got) !== JSON.stringify(c.want)) expect({ c, got }).toEqual({ c, got: c.want });
    }
  });
});

// ─── Frame functions (frame_fns.rs) ─────────────────────────────────────────────────

type FrameFnCase = { name: string; frames: FrameValue[]; args: unknown[]; want: unknown };
type Gen = ReturnType<typeof gen>;
/** Each TS frame function no formula shares, by the name the core knows it under, with a case generator. */
const FRAME_FNS: Record<string, { run: (frames: FrameValue[], args: unknown[]) => unknown; make: (g: Gen) => { frames: FrameValue[]; args: unknown[] } }> = {
  promoteHeaders: { run: ([f]) => promoteHeaders(f), make: (g) => ({ frames: [g.frame()], args: [] }) },
  demoteHeaders: { run: ([f]) => demoteHeaders(f), make: (g) => ({ frames: [g.frame()], args: [] }) },
  describeFrame: { run: ([f]) => describeFrame(f), make: (g) => ({ frames: [g.int(0, 3) ? g.frame() : numberFrame(g)], args: [] }) },
  correlationMatrix: {
    run: ([f], [m]) => correlationMatrix(f, m as CorrMethod),
    make: (g) => ({ frames: [numberFrame(g)], args: [g.pick(["pearson", "spearman", "kendall", "covariance"])] }),
  },
  reconcileFrames: {
    run: ([l, r], [leftKey, rightKey, priceColumn, qtyColumn]) => {
      const out = reconcileFrames(l, r, { leftKey, rightKey, priceColumn, qtyColumn } as never);
      return { __pair: true, frame: out.frame, value: reconcileSummaryList(out.summary) };
    },
    make: (g) => {
      const l = g.int(0, 2) ? g.frame() : numberFrame(g);
      const r = variant(g, l);
      const key = g.rand() < 0.05 ? "missing" : l.columns.length ? g.pick(l.columns).name : "none";
      const nums = l.columns.filter((c) => c.type === "number").map((c) => c.name);
      const opt = () => (g.rand() < 0.3 || !nums.length ? g.pick([undefined, "", "missing"]) : g.pick(nums));
      return { frames: [l, r], args: [key, g.rand() < 0.1 && r.columns.length ? g.pick(r.columns).name : key, opt(), opt()] };
    },
  },
  nestGroups: {
    run: ([f], [keys, name]) => { const r = nestGroups(f, keys as string[], name as string); return [r.names, r.groups]; },
    make: (g) => {
      const f = g.frame();
      const keys = f.columns.filter(() => g.rand() < 0.4).map((c) => c.name);
      if (g.rand() < 0.05) keys.push("missing");
      return { frames: [f], args: [keys, g.pick(["items", "", " x ", "a", "Col1", " "])] };
    },
  },
  lookupRowIndex: {
    run: ([f], [col, lookup, mm, sm]) => (Array.isArray(lookup)
      ? lookup.map((l) => lookupRowIndex(frameToCube(f), col as string, l, mm as LookupMatchMode, sm as LookupSearchMode))
      : lookupRowIndex(frameToCube(f), col as string, lookup as string, mm as LookupMatchMode, sm as LookupSearchMode)),
    make: (g) => { const { f, col, lookup, mm, sm } = lookupCase(g); return { frames: [f], args: [col, lookup, mm, sm] }; },
  },
  lookupCell: {
    run: ([f], [col, ret, lookup, mm, sm]) => (Array.isArray(lookup)
      ? lookup.map((l) => lookupCell(frameToCube(f), col as string, ret as string, l, mm as LookupMatchMode, sm as LookupSearchMode))
      : lookupCell(frameToCube(f), col as string, ret as string, lookup as string, mm as LookupMatchMode, sm as LookupSearchMode)),
    make: (g) => {
      const { f, col, lookup, mm, sm } = lookupCase(g);
      const ret = g.rand() < 0.05 ? "missing" : f.columns.length ? g.pick(f.columns).name : "none";
      return { frames: [f], args: [col, ret, lookup, mm, sm] };
    },
  },
  frameRowAt: { run: ([f], [i]) => frameRowAt(f, i as number), make: (g) => ({ frames: [g.frame()], args: [g.int(0, 10)] }) },
  getColumn: {
    run: ([f], [name]) => { const c = getColumn(f, name as string); return c ? f.columns.indexOf(c) : null; },
    make: (g) => {
      const f = g.frame();
      const name = g.rand() < 0.6 && f.columns.length ? g.pick(f.columns).name : g.pick(["1", "2", "5", "0", "07", " 1 ", "missing", "", " a ", "1.0"]);
      return { frames: [f], args: [g.rand() < 0.2 ? ` ${name} ` : name] };
    },
  },
  addColumn: {
    run: ([f], [name, values, type]) => {
      const out = addColumn(f, name as string, values as FrameCell[], type as FrameColType);
      const at = out.columns.length === f.columns.length ? f.columns.findIndex((c) => c.name === (name as string).trim()) : f.columns.length;
      return { __pair: true, frame: out, value: at };
    },
    make: (g) => {
      const f = g.frame();
      const type = g.pick(["number", "string", "logical", "date"] as const);
      const values = Array.from({ length: g.int(0, 6) }, () => g.cell(g.rand() < 0.7 ? type : g.pick(["number", "string"] as const)));
      const name = g.rand() < 0.5 && f.columns.length ? g.pick(f.columns).name : g.pick(["a", "b", "new", "", " x ", "Col1", "Col2", " a "]);
      return { frames: [f], args: [name, values, type] };
    },
  },
  splitFrame: {
    run: ([f]) => { const r = splitFrame(f); return [r.matrix, r.headers]; },
    make: (g) => ({ frames: [g.int(0, 2) ? numberFrame(g) : g.frame()], args: [] }),
  },
  buildFrame: {
    run: (_, [m, names]) => buildFrame(m as number[][], names as string[] | undefined),
    make: (g) => ({ frames: [], args: [matrixOf(g, () => g.cell("number")), headersOf(g)] }),
  },
  buildFrameTyped: {
    run: (_, [m, names, known]) => buildFrameTyped(m as unknown[][], names as string[] | undefined, known as FrameColType | null),
    make: (g) => {
      const one = g.pick(["number", "string", "logical", "date"] as const);
      const m = matrixOf(g, () => g.cell(g.rand() < 0.6 ? one : g.pick(["number", "string", "logical"] as const)));
      return { frames: [], args: [m, headersOf(g), g.pick([null, null, "number", "string", "logical", "date"])] };
    },
  },
  frameFromLists: {
    run: (_, [names, lists, known]) => frameFromLists((names as string[]).map((name, i) => ({ name, cells: (lists as unknown[][])[i], known: (known as (FrameColType | null)[])[i] }))),
    make: (g) => {
      const n = g.int(1, 4);
      const names = Array.from({ length: n }, () => g.pick(["a", "b", "", "a", "Col1", " v "]));
      const lists = Array.from({ length: n }, () => {
        const one = g.pick(["number", "string", "logical", "date"] as const);
        return Array.from({ length: g.int(0, 6) }, () => g.cell(g.rand() < 0.7 ? one : g.pick(["number", "string", "logical"] as const)));
      });
      return { frames: [], args: [names, lists, names.map(() => g.pick([null, null, "number", "string", "logical", "date"]))] };
    },
  },
  decisionMatrix: {
    run: ([f, w], [normalize, breakdown]) => {
      const { weights, normOverrides, bounds } = resolveDecisionWeights(w ?? null, decisionCriteria(f));
      return decisionMatrix(f, weights, normalize as DecisionNormalize, breakdown as boolean, normOverrides, bounds);
    },
    make: (g) => { const d = decisionGen(g); return { frames: d.frames, args: [d.normalize, d.rand() < 0.5] }; },
  },
  flipPoints: {
    run: ([f, w], [normalize]) => flipPoints(f, w ?? null, normalize as DecisionNormalize),
    make: (g) => { const d = decisionGen(g); return { frames: d.frames, args: [d.normalize] }; },
  },
  allocateFrame: { run: ([f], [mode, amount]) => allocateFrame(f, mode as AllocateMode, amount as number), make: allocatorGen },
  payoffFrame: {
    run: ([f], [extra, order, view, start]) => payoffFrame(f, extra as number, order as PayoffOrder, view as PayoffView, start as number | null),
    make: payoffGen,
  },
  settleFrame: {
    run: ([f], [split]) => { const r = settleFrame(f, split as SettleSplit); return { __frame: true, columns: [...r.transfers.columns, ...r.net.columns] }; },
    make: settleGen,
  },
  settleLedger: {
    run: ([f], [units]) => {
      const cube = frameToCube(f);
      const usd = { dim: { length: 1 } } as ColumnUnit;
      const tagged = { ...cube, columns: cube.columns.map((c) => ((units as string[]).includes(c.name) ? { ...c, cells: c.cells.map((v) => tagFrameCellUnit(v, usd) as CubeCell) } : c)) };
      const r = settleLedgerCube(tagged);
      return { __frame: true, columns: [...r.transfers.columns, ...r.net.columns].map(({ unit: _u, ...c }) => c) };
    },
    make: ledgerGen,
  },
  amortizationSchedule: {
    run: (_, [rate, nper, pv, fv, type]) => amortizationFrame(rate as number, nper as number, pv as number, fv as number, type as 0 | 1),
    make: (g) => {
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(g.rand() * xs.length)];
      return { frames: [], args: [pick([0, 0.05, 0.05 / 12, -0.01, 1e-13, 0.3, NaN, Infinity]), pick([0, 1, 2, 12, 60, 360, 0.5, 2.7, -3, NaN]), pick([1000, -200000, 0, 12345.67, -0]), pick([0, 500, -1000]), pick([0, 1] as const)] };
    },
  },
  kmeans: {
    run: ([f], [k]) => { const r = kmeansOutputs(numericRows(f), k as number); return r && { __frame: true, columns: [{ name: "Labels", type: "number", values: r.labels }, ...r.centers.columns] }; },
    make: (g) => ({ frames: [mlFrame(g, null)], args: [[1, 2, 3, 4, 0, 2.5, 20, Infinity, -1][g.int(0, 8)]] }),
  },
  pca: {
    run: ([f], [standardize]) => { const r = pcaOutputs(numericRows(f), standardize as boolean); return r && { __frame: true, columns: [...r.scores.columns, ...r.loadings.columns, { name: "Explained", type: "number", values: r.explained }] }; },
    make: (g) => ({ frames: [mlFrame(g, null)], args: [g.rand() < 0.5] }),
  },
  logisticFit: {
    run: ([f], [t]) => {
      const tcol = f.columns.find((c) => c.name === t)!;
      const r = logisticOutputs(f, tcol, f.columns.filter((c) => c !== tcol && c.type === "number"));
      return r && { __frame: true, columns: [...r.coefficients.columns, { name: "Probabilities", type: "number", values: r.probabilities }] };
    },
    make: (g) => ({ frames: [mlFrame(g, "y")], args: ["y"] }),
  },
};

/** A frame of mostly number columns, often whole (every cell finite), the shape correlation and splitting read. */
function numberFrame(g: Gen): FrameValue {
  const rows = g.int(0, 8);
  const whole = g.rand() < 0.5;
  const columns = Array.from({ length: g.int(0, 4) }, (_, i) => {
    const type: FrameColType = g.rand() < 0.85 ? "number" : g.pick(["string", "logical", "date"] as const);
    const len = g.rand() < 0.1 ? g.int(0, rows) : rows;
    const values = Array.from({ length: len }, () => (whole && type === "number" ? g.int(-3, 5) : g.cell(type)));
    return { name: g.pick(["a", "b", "c", "k", "a", "column", "Col2"]) + (g.rand() < 0.7 ? String(i) : ""), type, values };
  });
  return { __frame: true, columns };
}

/** Another version of a frame: some cells changed, rows reordered, a column dropped or added. */
function variant(g: Gen, f: FrameValue): FrameValue {
  const rev = g.rand() < 0.3;
  const columns = f.columns.filter(() => g.rand() < 0.85).map((c) => {
    const values = c.values.map((v) => (g.rand() < 0.2 ? g.cell(g.rand() < 0.9 ? c.type : "string") : v)).slice(0, g.rand() < 0.2 ? g.int(0, c.values.length) : undefined);
    return { ...c, type: g.rand() < 0.05 ? g.pick(["number", "string"] as const) : c.type, values: rev ? values.reverse() : values };
  });
  if (g.rand() < 0.3) columns.push(...g.frame().columns.slice(0, 1));
  return { __frame: true, columns };
}

function lookupCase(g: Gen) {
  const f = g.frame();
  const col = g.rand() < 0.05 ? "missing" : f.columns.length ? g.pick(f.columns).name : "none";
  const c = f.columns.find((x) => x.name === col);
  const one = (): string => {
    if (c && c.values.length && g.rand() < 0.5) {
      const v = g.pick(c.values);
      return v === null || typeof v === "object" ? "" : String(v);
    }
    return g.pick(["x", "APPLE", "1", "2.5", "-3", "45003", " 45005 ", "true", "FALSE", "yes", "1,000", "2023-03-15", "2023-02-30",
      "15-Mar-2023", "3/4/2023", "-0", "1e3", "NaN", "abc"]);
  };
  const lookup = g.rand() < 0.2 ? Array.from({ length: g.int(0, 4) }, one) : one();
  const mm = g.pick(["exact", "exact", "nextSmaller", "nextLarger"]);
  const sm = g.pick(["first", "last"]);
  return { f, col, lookup, mm, sm };
}

const matrixOf = (g: Gen, cell: () => unknown): unknown[][] =>
  Array.from({ length: g.int(0, 5) }, () => Array.from({ length: g.int(0, 4) }, cell));

const headersOf = (g: Gen): string[] | undefined =>
  (g.rand() < 0.2 ? undefined : Array.from({ length: g.int(0, 5) }, () => g.pick(["a", "b", "", " a ", "Col1", "Col2", "x"])));

/** Number features with a few blanks and repeats, and with `target` a 0/1 column to predict. */
function mlFrame(g: Gen, target: string | null): FrameValue {
  const rand = g.rand;
  const rows = target ? g.int(2, 16) : g.int(0, 12);
  const cell = (): FrameCell => (rand() < 0.06 ? (rand() < 0.5 ? null : "x") : rand() < 0.5 ? g.int(-2, 3) : Math.round(rand() * 400 - 200) / 16);
  const columns: FrameColumn[] = Array.from({ length: g.int(target ? 1 : 0, 3) }, (_, j) => ({ name: ["u", "v", "w"][j], type: "number", values: Array.from({ length: rows }, cell) }));
  if (rand() < 0.3) columns.push({ name: "label", type: "string", values: Array.from({ length: rows }, () => "a") });
  if (target) {
    const logical = rand() < 0.3;
    const yv = (i: number): FrameCell => {
      const u = columns[0].values[i];
      const lean = typeof u === "number" ? u + (rand() - 0.5) * 6 : 0;
      const one = rand() < 0.15 ? rand() < 0.5 : lean > 0;
      return rand() < 0.05 ? pick3(rand, [null, 2, -0]) : logical ? one : one ? 1 : 0;
    };
    columns.splice(g.int(0, columns.length), 0, { name: target, type: logical ? "logical" : "number", values: Array.from({ length: rows }, (_, i) => yv(i)) });
  }
  return { __frame: true, columns };
}
const pick3 = <T,>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

function payoffGen(g: Gen) {
  const rand = g.rand;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const rows = g.int(0, 4);
  const col = (names: string[], vals: () => FrameCell): FrameColumn | null =>
    rand() < 0.92 ? { name: pick(names), type: "number", values: Array.from({ length: rows }, () => (rand() < 0.03 ? pick([null, NaN, solError("#N/A", "fuzz")]) : vals())) } : null;
  const columns = [
    rand() < 0.85 ? { name: pick(["Debt", "Card"]), type: "string" as const, values: Array.from({ length: rows }, () => pick(["Visa", "Car", "Loan", null, "", "Visa"])) } : null,
    col(["Balance", "Owed", "Amount"], () => pick([0, 500, 2500, 12000.5, 30000, -5])),
    col(["APR", "Rate", "r"], () => pick([0, 0.18, 24, 0.05, 1, 99])),
    col(["Min", "Payment", "Minimum"], () => pick([0, 25, 100, 300, 50.5])),
  ].filter((c): c is FrameColumn => c != null);
  if (rand() < 0.2) columns.reverse();
  return { frames: [{ __frame: true, columns } as FrameValue], args: [pick([0, 100, 250.5, -10, NaN]), pick(["avalanche", "snowball"]), pick(["summary", "schedule"]), pick([null, 45000, 46022, 45016.7, 45350, NaN, 1e9])] };
}

function settleGen(g: Gen) {
  const rand = g.rand;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const rows = g.int(0, 7);
  const columns: FrameColumn[] = [];
  if (rand() < 0.85) columns.push({ name: pick(["Person", "Who"]), type: "string", values: Array.from({ length: rows }, () => pick(["Ada", "ada ", "Bo", "Cy", "", null, "Di", "BO"])) });
  if (rand() < 0.92) columns.push({ name: pick(["Paid", "Amount", "spent", "X"]), type: "number", values: Array.from({ length: rows }, () => (rand() < 0.04 ? pick([null, NaN, solError("#N/A", "fuzz")]) : pick([0, 10, 33.33, 100, 250.75, 7, 1e3]))) });
  if (rand() < 0.5) columns.push({ name: pick(["Share", "Weight", "shares"]), type: "number", values: Array.from({ length: rows }, () => pick([1, 2, 0.5, 0, -1, null, 3])) });
  if (rand() < 0.2) columns.reverse();
  return { frames: [{ __frame: true, columns } as FrameValue], args: [pick(["equal", "weighted"])] };
}

/** A ledger: amounts as numbers, money text or unit cells, payers and beneficiaries as comma lists in any case. */
function ledgerGen(g: Gen) {
  const rand = g.rand;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const rows = g.int(0, 7);
  const names = () => pick(["Ada", "ada", " Bo ", "Bo, Cy", "cy,ADA", "", " , ", null, "Di;Ed", 7, true, solError("#N/A", "fuzz")]);
  const unit = rand() < 0.3;
  const columns: FrameColumn[] = [];
  if (rand() < 0.92) {
    const name = pick(["Amount", "cost", " Total ", "Spend"]);
    const values = Array.from({ length: rows }, () => (unit ? pick([10, 0, 33.33, -5, null, 1e3]) : pick([10, 33.33, 0, -5, null, NaN, Infinity, "$1,200", "£ 3.5", "", "0x10", "abc", "1e2", true, solError("#DIV/0!", "fuzz")])));
    columns.push({ name, type: unit ? "number" : "string", values: values as FrameCell[] });
  }
  if (rand() < 0.92) columns.push({ name: pick(["Paid by", "payer", "Paid", "Who paid", "From"]), type: "string", values: Array.from({ length: rows }, names) as FrameCell[] });
  if (rand() < 0.6) columns.push({ name: pick(["For", "Split between", "shared with", "Owed by"]), type: "string", values: Array.from({ length: g.int(0, rows) }, names) as FrameCell[] });
  if (rand() < 0.2) columns.push({ name: "Note", type: "string", values: Array.from({ length: rows }, () => pick(["x", null])) });
  if (rand() < 0.3) columns.reverse();
  const units = unit && columns.some((c) => c.type === "number") ? [columns.find((c) => c.type === "number")!.name] : [];
  return { frames: [{ __frame: true, columns } as FrameValue], args: [units] };
}

/** An options frame with criteria and, mostly, a Weights frame naming them, with norms and deal-breakers. */
function decisionGen(g: Gen) {
  const rand = g.rand;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const rows = g.int(0, 8);
  const num = (): FrameCell => {
    const r = rand();
    if (r < 0.08) return null;
    if (r < 0.085) return solError("#N/A", "fuzz");
    if (r < 0.115) return pick([NaN, Infinity, -Infinity, -0, 1e308, "7", true]);
    return rand() < 0.6 ? g.int(-3, 9) : Math.round(rand() * 2000 - 500) / 8;
  };
  const crit = ["Cost", "Speed", "Risk", "Fun", "Score", "cost"].filter(() => rand() < 0.6);
  const columns: FrameColumn[] = [];
  if (rand() < 0.85) columns.push({ name: pick(["Option", "Name", "Score", ""]), type: "string", values: Array.from({ length: rows }, () => (rand() < 0.1 ? null : pick(["A", "B", "C", "D", "é", "", "A"]))) });
  for (const name of crit) {
    const logical = rand() < 0.15;
    columns.push({ name, type: logical ? "logical" : rand() < 0.1 ? "date" : "number", values: Array.from({ length: rand() < 0.1 ? g.int(0, rows) : rows }, () => (logical ? (rand() < 0.1 ? null : rand() < 0.05 ? 2 : rand() < 0.5) : num())) });
  }
  if (rand() < 0.2) columns.push({ name: "Notes", type: "string", values: Array.from({ length: rows }, () => pick(["x", null])) });
  if (rand() < 0.1) columns.splice(g.int(0, columns.length), 0, { name: "Tag", type: "string", values: Array.from({ length: rows }, () => "t") });
  const frames: FrameValue[] = [{ __frame: true, columns }];
  if (rand() < 0.8) {
    const names = [...crit.map((c) => pick([c, ` ${c.toUpperCase()} `, c])), ...(rand() < 0.3 ? ["Other", ""] : [])].filter(() => rand() < 0.85);
    const n = names.length;
    const wcols: FrameColumn[] = [{ name: "Criterion", type: "string", values: names }];
    if (rand() < 0.9) wcols.push({ name: pick(["Weight", "Value", "W", "weights"]), type: "number", values: Array.from({ length: n }, () => (rand() < 0.1 ? null : rand() < 0.03 ? pick([NaN, true, "2"]) : pick([-3, -1, 0, 1, 2, 3, 0.5, -0]))) });
    if (rand() < 0.2) wcols.push({ name: "Other", type: "number", values: Array.from({ length: n }, () => g.int(-2, 4)) });
    if (rand() < 0.3) wcols.push({ name: pick(["Norm", " norm "]), type: "string", values: Array.from({ length: n }, () => pick(["raw", "none", "Max", "÷ max", "range", "min max", "rank", "nope", null])) });
    if (rand() < 0.35) wcols.push({ name: pick(["At least", "at least "]), type: "number", values: Array.from({ length: n }, () => (rand() < 0.5 ? null : rand() < 0.03 ? solError("#VALUE!", "bad bound") : pick([0, 1, 2.5, 1234.56789, -1, 1e21, 0.00001]))) });
    if (rand() < 0.35) wcols.push({ name: "At most", type: rand() < 0.1 ? "string" : "number", values: Array.from({ length: n }, () => (rand() < 0.5 ? null : pick([3, 5, 2400, 1e6, -0.5, 7.123456]))) });
    frames.push({ __frame: true, columns: wcols });
  }
  return { frames, normalize: pick(["none", "max", "range", "rank"]), rand };
}

function allocatorGen(g: Gen) {
  const rand = g.rand;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const rows = g.int(0, 6);
  const nums = (lo: number, hi: number) => Array.from({ length: rows }, (): FrameCell => (rand() < 0.04 ? pick([null, NaN, "5", solError("#N/A", "fuzz")]) : rand() < 0.5 ? g.int(lo, hi) * 1000 : Math.round(rand() * (hi - lo) + lo) * 100));
  const columns: FrameColumn[] = [];
  if (rand() < 0.8) columns.push({ name: pick(["Category", "Item"]), type: "string", values: Array.from({ length: rows }, () => pick(["Car", "Housing", null, "Other", ""])) });
  if (rand() < 0.9) columns.push({ name: pick(["Min", " min ", "Low"]), type: "number", values: nums(0, 30) });
  if (rand() < 0.9) columns.push({ name: pick(["Max", "MAX", "High"]), type: "number", values: nums(10, 60) });
  if (rand() < 0.7) columns.push({ name: pick(["Weight", "Value", "weights"]), type: rand() < 0.1 ? "string" : "number", values: Array.from({ length: rows }, () => (rand() < 0.1 ? pick([null, NaN, -1, 0, "2"]) : pick([1, 2, 3, 0.5, 0]))) });
  if (rand() < 0.2) columns.push({ name: "Extra", type: "number", values: nums(0, 9) });
  if (rand() < 0.2) columns.reverse();
  return { frames: [{ __frame: true, columns } as FrameValue], args: [pick(["budget", "budget", "minTarget", "minProportional"]), pick([0, 50000, 60000, 120000, 1e6, -5, 25000.5, 90000])] };
}
/** A frame function's answer as comparable data: a frame, a value, or (`__pair`) a frame with a value beside it. */
const fnOutcome = (run: () => unknown): unknown => {
  try {
    const r = run();
    if (r && typeof r === "object" && (r as { __pair?: boolean }).__pair) {
      const p = r as { frame: FrameValue; value: unknown };
      return { frame: view(p.frame), value: canon(p.value) };
    }
    return r && typeof r === "object" && (r as FrameValue).__frame ? { frame: view(r as FrameValue) } : { value: canon(r) };
  } catch (e) {
    return isSolError(e) ? { error: { code: e.code, message: wf(e.message) } } : { error: { code: "thrown", message: String(e) } };
  }
};

const frameFns = frozen<FrameFnCase>("frame-fns", () => Object.entries(FRAME_FNS).flatMap(([name, fn]) => {
  const g = gen(mulberry32(5150 + name.length));
  return Array.from({ length: 1000 }, () => {
    const { frames, args } = fn.make(g);
    return { name, frames, args, want: fnOutcome(() => fn.run(frames, args)) };
  });
}));

describe("frame functions answer as frozen", () => {
  const byFn = new Map<string, FrameFnCase[]>();
  for (const c of frameFns) (byFn.get(c.name) ?? byFn.set(c.name, []).get(c.name)!).push(c);
  for (const [name, cases] of byFn) {
    it(`${name} (${cases.length})`, () => {
      let ran = 0;
      for (const c of cases) {
        let bailed = false;
        const got = fnOutcome(() => {
          const r = frameFnOnCore(name, c.frames, c.args);
          if (!r) { bailed = true; return null; }
          return "frame" in r ? ("value" in r ? { __pair: true, frame: r.frame, value: r.value } : r.frame) : r.value;
        });
        if (bailed) continue;
        ran++;
        if (JSON.stringify(got) !== JSON.stringify(c.want)) expect({ name, frames: c.frames, args: c.args, got }).toEqual({ name, frames: c.frames, args: c.args, got: c.want });
      }
      checkBails(`frame fn ${name}`, cases.length - ran);
    });
  }
});

// ─── Formulas over values (the Expression card) ───────────────────────────────────

type ExprCase = { src: string; env: Record<string, unknown>; want: unknown };

/** Formulas over scalars, lists, matrices and text: the evaluator's whole surface, including list answers. */
const expressions = frozen<ExprCase>("expressions", () => {
  const cases: ExprCase[] = [];
  const rand = mulberry32(6060);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const names = [...new Set([...FX_FUNCTION_NAMES, ...internalFunctionNames()])].filter((n) => !/^(RAND|RANDBETWEEN|RANDARRAY|RANDDIST|SHUFFLE|UUID|NOW|TODAY)$/.test(n) && resolveExcelFunction(n)).sort();
  const leaf = () => pick(["x", "y", "xs", "ys", "m", "t", "ts", "1", "2", "-3.5", "0", "\"a\"", "\"\"", "TRUE", "FALSE", "{1,2,3}", "x * 2", "xs + 1", "m * 2"]);
  const lambda = () => pick(["LAMBDA(v, v * 2)", "LAMBDA(v, IF(v > 0, v, 0))", "LAMBDA(a, b, a + b)", "LAMBDA(acc, v, acc + v)", "LAMBDA(r, SUM(r))", "LAMBDA(i, j, i * j)"]);
  const expr = (depth: number): string => {
    const r = rand();
    if (depth <= 0 || r < 0.25) return leaf();
    if (r < 0.4) return `${expr(depth - 1)} ${pick(["+", "-", "*", "/", "&", "=", "<", ">="])} ${expr(depth - 1)}`;
    const name = rand() < 0.12 ? pick(["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY"]) : pick(names);
    const n = Math.floor(rand() * 4);
    const args = Array.from({ length: n }, () => expr(depth - 1));
    if (["MAP", "BYROW", "BYCOL"].includes(name)) return `${name}(${pick(["xs", "m", "ys", "ts"])}, ${lambda()})`;
    if (name === "REDUCE" || name === "SCAN") return `${name}(${pick(["0", "1", "\"\""])}, ${pick(["xs", "m", "ys"])}, ${lambda()})`;
    if (name === "MAKEARRAY") return `MAKEARRAY(${pick(["2", "3", "1"])}, ${pick(["2", "1", "3"])}, ${lambda()})`;
    return `${name}(${args.join(", ")})`;
  };
  for (let i = 0; i < 20000; i++) {
    const env: Record<string, unknown> = {
      x: pick([3, -1.5, 0, 45000, null, "7", true]), y: pick([2, 0.5, -4, 10]),
      xs: pick([[1, 2, 3], [4, -2, 0, 9], [], [1.5, null, 3], [5]]), ys: pick([[3, 1, 2], [0.5, 0.25, 0.75, 1], [2, 2, 2]]),
      m: pick([[[1, 2], [3, 4]], [[1, 2, 3]], [[1], [2], [3]], [[0, -1], [5, 2], [7, 8]]]),
      t: pick(["abc", "Hello World", "", "a,b,c", "2024-03-15"]), ts: pick([["a", "b", "a"], ["x"], ["10", "9", "x"]]),
    };
    const src = expr(3);
    const ev = compileTsEvaluator(src);
    if (!ev) continue;
    let want: unknown;
    const t = performance.now();
    try { want = canon(ev(structuredClone(env))); } catch (e) { want = isSolError(e) ? canon(e) : { thrown: String((e as Error).message ?? e) }; }
    if (performance.now() - t > 1000 || JSON.stringify(want).includes('"other"')) continue;
    cases.push({ src, env, want });
  }
  return cases;
});

describe("formulas over values answer as frozen", () => {
  it(`${expressions.length} formulas`, { timeout: 600_000 }, () => {
    let ran = 0;
    const bad: unknown[] = [];
    for (const c of expressions) {
      const raw = wasmInvokeSync<{ bail?: boolean } | null>("engine_eval", { src: c.src, env: Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, wire(v)])), clock: engineClock() });
      if (raw && raw.bail) continue;
      ran++;
      const got = engineAnswer("", raw);
      if (JSON.stringify(got) !== JSON.stringify(c.want)) bad.push({ src: c.src, env: c.env, got, want: c.want });
    }
    if (process.env.CORE_DUMP) fs.writeFileSync(process.env.CORE_DUMP, `${ran} ran, ${bad.length} differ\n` + bad.map((b) => JSON.stringify(b)).join("\n"));
    expect(bad.slice(0, 5)).toEqual([]);
    checkBails("formulas over values", expressions.length - ran);
  });
});

// ─── Formula dimensions (unitDimExpr.ts) ─────────────────────────────────────────

type DimCase = { src: string; env: Record<string, Record<string, number>>; codes: Record<string, string>; want: unknown };

/** The dimension `dimEvalWithCode` gives a formula over united names ([[C25]] firstClassUnits): mixed dimensions,
 *  currency codes, constant and computed powers, every function class, LAMBDA hosts and applications. */
const unitDims = frozen<DimCase>("unit-dims", () => {
  const cases: DimCase[] = [];
  const rand = mulberry32(2525);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const DIMS: Record<string, Record<string, number>[]> = {
    a: [{ length: 1 }], b: [{ length: 1 }, { time: 1 }], c: [{ time: 1 }, {}], d: [{ currency: 1 }], e: [{ currency: 1 }],
    f: [{ angle: 1 }, { angle: 2 }], g: [{}], h: [{ mass: 1, length: 1, time: -2 }, { length: 2 }],
    w: [{ "custom:widget": 1 }, { "custom:widget": 1, time: -1 }], p: [{ currency: 1 }, { length: 1, angle: 0 }],
  };
  const vars = Object.keys(DIMS);
  const fns = ["SIN", "COS", "TAN", "COT", "ATAN2", "EXP", "LN", "LOG10", "COUNT", "COUNTIF", "ISNUMBER", "LEN", "TEXT", "AND", "RANK",
    "CORREL", "ABS", "MIN", "MAX", "MEDIAN", "SUM", "AVERAGE", "ROUND", "MOD", "STDEV", "STDEV.P", "STDEVP", "VARP", "VAR", "VAR.S", "DEVSQ",
    "SUMSQ", "PRODUCT", "SUMPRODUCT", "SQRT", "POWER", "IF", "IFS", "SWITCH", "IFERROR", "IFNA", "CHOOSE", "LARGE", "SMALL",
    "PERCENTILE", "INDEX", "SORT", "TAKE", "FILTER", "AVERAGEIF", "SUMIFS", "MAXIFS", "XLOOKUP", "VLOOKUP", "LOOKUP", "SIGN", "FLOOR",
    "LAMBDA", "NOSUCHFN", "TEXTFILTER", "UPPER", "CONVERT", "NPV", "RAND", "PI", "SEQUENCE", "MMULT", "AVERAGEA", "CEILINGMATH"];
  const lambda = () => pick(["LAMBDA(v, v * 2)", "LAMBDA(v, v * v)", "LAMBDA(acc, v, acc + v)", "LAMBDA(acc, v, acc * v)",
    "LAMBDA(r, SUM(r))", "LAMBDA(i, j, i * j)", "LAMBDA(x, y, x / y)", "LAMBDA(v, IF(v > 0, v, 0))", "MAX", "SUM", "SQRT", "a", "LAMBDA(v)"]);
  const leaf = () => pick([...vars, ...vars, "1", "2", "0", "-3.5", "\"t\"", "TRUE", "{1,2,3}", "@a", "a%", "-a", "t", "q"]);
  const pow = () => pick(["2", "0.5", "1/2", "-1", "3", "1/3", "(2+1)", "g", "a", "0", "1/0", "-2^2"]);
  const expr = (depth: number): string => {
    const r = rand();
    if (depth <= 0 || r < 0.22) return leaf();
    if (r < 0.45) return `${expr(depth - 1)} ${pick(["+", "-", "*", "/", "&", "=", "<", ">=", "<>", "+", "-", "*", "/"])} ${expr(depth - 1)}`;
    if (r < 0.52) return `(${expr(depth - 1)}) ^ ${pow()}`;
    if (r < 0.6) {
      const host = pick(["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY"]);
      if (host === "REDUCE" || host === "SCAN") return `${host}(${pick(["0", "1", "a", "d"])}, ${expr(depth - 1)}, ${lambda()})`;
      if (host === "MAKEARRAY") return `MAKEARRAY(2, 3, ${lambda()})`;
      if (host === "MAP" && rand() < 0.4) return `MAP(${expr(depth - 1)}, ${expr(depth - 1)}, ${lambda()})`;
      return `${host}(${expr(depth - 1)}, ${lambda()})`;
    }
    if (r < 0.64) return `${pick(["LAMBDA(x, x * a)", "LAMBDA(x, y, x + y)", "LAMBDA(x, x ^ 2)", "SUM", "LAMBDA(x)"])}(${expr(depth - 1)}, ${expr(depth - 1)})`;
    const n = Math.floor(rand() * 5);
    return `${pick(fns)}(${Array.from({ length: n }, () => (rand() < 0.08 ? "" : expr(depth - 1))).join(", ")})`;
  };
  for (let i = 0; i < 20000; i++) {
    const env: Record<string, Record<string, number>> = {};
    const codes: Record<string, string> = {};
    for (const v of vars) if (rand() < 0.8) env[v] = pick(DIMS[v]);
    if (env.d) codes.d = pick(["usd", "usd", "eur"]);
    if (env.e) codes.e = pick(["eur", "gbp", "usd"]);
    const src = expr(3);
    const ast = parseFormula(src);
    if (!ast) continue;
    cases.push({ src, env, codes, want: dimAnswer(dimEvalWithCode(ast, env, codes)) });
  }
  return cases;
});

/** A dimension answer as comparable data: sorted axes, each exponent as its `String(x)`, zeros dropped. */
function dimAnswer(r: ReturnType<typeof dimEvalWithCode>): unknown {
  if (r === null) return { indeterminate: true };
  if (isSolError(r)) return { err: r.code, msg: r.message };
  const dim = Object.keys(r.dim).sort().filter((k) => r.dim[k] !== 0).map((k) => [k, String(r.dim[k])]);
  return { dim, code: r.code ?? null };
}

describe("formula dimensions answer as frozen", () => {
  it(`${unitDims.length} formulas`, () => {
    const bad: unknown[] = [];
    for (const c of unitDims) {
      const raw = wasmInvokeSync<{ dim?: unknown; code?: unknown }>("engine_dim_eval", { src: c.src, env: c.env, codes: c.codes });
      const got = raw.dim ? { dim: raw.dim, code: raw.code } : raw;
      if (JSON.stringify(got) !== JSON.stringify(c.want)) bad.push({ src: c.src, env: c.env, codes: c.codes, got, want: c.want });
    }
    if (process.env.CORE_DUMP) fs.writeFileSync(process.env.CORE_DUMP, `${bad.length} differ\n` + bad.map((b) => JSON.stringify(b)).join("\n"));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// ─── Affine weights (unitDimExpr.ts) ────────────────────────────────────────────

type AffCase = { src: string; points: string[]; lists: string[]; bare: string[]; fns: Record<string, [string[], string]>; want: unknown };

/** `affineWeight` over readings (°C, °F), lists of readings, wired plain numbers and named LAMBDAs ([[C25]] firstClassUnits). */
const affineCases = frozen<AffCase>("affine-weights", () => {
  const cases: AffCase[] = [];
  const rand = mulberry32(3131);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const FNS: Record<string, [string[], string]>[] = [{}, { half: [["x"], "x / 2"] }, { mid: [["x", "y"], "(x + y) / 2"], dbl: [["v"], "v * 2"] }, { diff: [["x", "y"], "x - y"] }];
  const fns = ["MIN", "MAX", "MEDIAN", "AVERAGE", "AVG", "STDEV", "VAR", "DEVSQ", "AVEDEV", "SUM", "ABS", "ROUND", "INT", "LARGE", "INDEX", "SORT",
    "TAKE", "AVERAGEIF", "SUMIFS", "MAXIFS", "XLOOKUP", "IF", "IFS", "SWITCH", "IFERROR", "CHOOSE", "COUNT", "LEN", "SQRT", "EXP", "LAMBDA",
    "half", "mid", "dbl", "diff", "NOSUCH"];
  const lambda = () => pick(["LAMBDA(v, v * 2)", "LAMBDA(v, v - 1)", "LAMBDA(acc, v, acc + v)", "LAMBDA(acc, v, MAX(acc, v))", "LAMBDA(acc, v, acc)",
    "LAMBDA(r, SUM(r))", "LAMBDA(r, AVERAGE(r))", "LAMBDA(i, j, i * j)", "MAX", "MIN", "SUM", "LAMBDA(v)", "LAMBDA(x, y, x - y)"]);
  const leaf = () => pick(["a", "b", "t", "xs", "n", "a", "b", "1", "2", "0", "-3.5", "0.5", "\"t\"", "TRUE", "@a", "@b", "a%", "-a", "q", "{1,2}"]);
  const expr = (depth: number): string => {
    const r = rand();
    if (depth <= 0 || r < 0.22) return leaf();
    if (r < 0.5) return `${expr(depth - 1)} ${pick(["+", "-", "*", "/", "^", "&", "=", "<", "+", "-", "*", "/", "+", "-"])} ${expr(depth - 1)}`;
    if (r < 0.55) return `(${expr(depth - 1)})`;
    if (r < 0.63) {
      const host = pick(["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY"]);
      if (host === "REDUCE" || host === "SCAN") return `${host}(${pick(["0", "1", "a", "n", "xs"])}, ${expr(depth - 1)}, ${lambda()})`;
      if (host === "MAKEARRAY") return `MAKEARRAY(2, 3, ${lambda()})`;
      if (host === "MAP" && rand() < 0.4) return `MAP(${expr(depth - 1)}, ${expr(depth - 1)}, ${lambda()})`;
      return `${host}(${expr(depth - 1)}, ${lambda()})`;
    }
    if (r < 0.67) return `${pick(["LAMBDA(x, x * 2)", "LAMBDA(x, y, x + y)", "LAMBDA(x, (x + a) / 2)", "SUM", "LAMBDA(x)", "MAX"])}(${expr(depth - 1)}, ${expr(depth - 1)})`;
    const n = Math.floor(rand() * 5);
    return `${pick(fns)}(${Array.from({ length: n }, () => (rand() < 0.08 ? "" : expr(depth - 1))).join(", ")})`;
  };
  for (let i = 0; i < 20000; i++) {
    const points = ["a", "b", "t", "xs"].filter(() => rand() < 0.7);
    const lists = ["xs", "t"].filter(() => rand() < 0.6);
    const bare = ["n", "q"].filter(() => rand() < 0.6);
    const fnsHere = pick(FNS);
    const src = expr(3);
    const ast = parseFormula(src);
    if (!ast) continue;
    const named = new Map<string, Lam>();
    for (const [k, [params, body]] of Object.entries(fnsHere)) named.set(k, { params, body: parseFormula(body)! });
    const w = affineWeight(ast, new Set(points), new Set(lists), named, new Set(bare));
    cases.push({ src, points, lists, bare, fns: fnsHere, want: isSolError(w) ? { err: w.code, msg: w.message } : { w } });
  }
  return cases;
});

describe("affine weights answer as frozen", () => {
  it(`${affineCases.length} formulas`, () => {
    const bad: unknown[] = [];
    for (const c of affineCases) {
      const got = wasmInvokeSync<unknown>("engine_affine_weight", { src: c.src, points: c.points, lists: c.lists, bare: c.bare, fns: c.fns });
      if (JSON.stringify(got) !== JSON.stringify(c.want)) bad.push({ ...c, got });
    }
    if (process.env.CORE_DUMP) fs.writeFileSync(process.env.CORE_DUMP, `${bad.length} differ\n` + bad.map((b) => JSON.stringify(b)).join("\n"));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// ─── List bodies over values with a unit ─────────────────────────────────────────

type UnitListCase = { name: string; args: unknown[]; want: unknown };

/** A value with its unit cells spelled out, so frozen and replayed answers compare as data. */
function unitData(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unitData);
  if (isUnitCell(v)) return { __u: v.value, dim: Object.keys(v.dim).sort().map((k) => [k, v.dim[k]]), display: v.display ?? null, ratio: v.ratio ?? false };
  return v;
}

/** The bodies that move values with a unit without reading them ([[C25]] firstClassUnits): the core takes those cells
 *  as they are (`UNIT_READY` in unit_dims.rs). */
const unitLists = frozen<UnitListCase>("unit-lists", () => {
  const cases: UnitListCase[] = [];
  const rand = mulberry32(4242);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const units: UnitCell[] = [
    { __unitCell: true, value: 5000, dim: { length: 1 }, display: "km" }, { __unitCell: true, value: 1.5, dim: { length: 1 } },
    { __unitCell: true, value: 293.15, dim: { temperature: 1 }, display: "degC" }, { __unitCell: true, value: 5, dim: { currency: 1 }, display: "usd" },
    { __unitCell: true, value: 2.5, dim: {}, ratio: true }, { __unitCell: true, value: -0.25, dim: { length: 1, time: -1 }, display: "ms1" },
    { __unitCell: true, value: 3, dim: { "custom:widget": 1 } },
  ];
  const cell = () => pick([...units, ...units, 1, -2.5, 0, null, "a", "", true]);
  const list = (): unknown => (rand() < 0.15 ? cell() : Array.from({ length: Math.floor(rand() * 6) }, cell));
  const num = () => pick([0, 1, 2, -1, -3, 3, 10, 2.5, null, undefined, "2"]);
  for (let i = 0; i < 4000; i++) {
    const name = pick(["REVERSE", "SLICE", "NTHELEMENT", "INTERLEAVE", "CONCATLISTS", "PADLEFT", "PADRIGHT"]);
    const args = name === "REVERSE" ? [list()]
      : name === "SLICE" ? [list(), num(), num()]
      : name === "NTHELEMENT" ? [list(), num()]
      : name === "INTERLEAVE" ? [list(), list()]
      : name === "CONCATLISTS" ? Array.from({ length: 1 + Math.floor(rand() * 3) }, list)
      : [list(), pick([0, 2, 5, 7, -1, null]), pick([...units, 0, null, undefined, "x"])];
    let want: unknown;
    try { want = unitData(resolveExcelFunction(name)!(...structuredClone(args))); } catch (e) { want = { thrown: String((e as Error).message ?? e) }; }
    cases.push({ name, args, want });
  }
  return cases;
});

function replayUnitCalls(cases: readonly UnitListCase[]): void {
  const bad: unknown[] = [];
  for (const c of cases) {
    const r = readReply(wasmInvokeSync<unknown>("engine_call", { name: c.name, args: c.args.map((a) => coreValue(a, true)), clock: engineClock() }));
    const got = r ? unitData(r.value) : { bailed: true };
    if (JSON.stringify(enc(got)) !== JSON.stringify(enc(c.want))) bad.push({ name: c.name, args: c.args, got, want: c.want });
  }
  if (process.env.CORE_DUMP) fs.writeFileSync(process.env.CORE_DUMP, `${bad.length} differ\n` + bad.map((b) => JSON.stringify(enc(b))).join("\n"));
  expect(bad.slice(0, 5)).toEqual([]);
}

describe("list bodies over values with a unit answer as frozen", () => {
  it(`${unitLists.length} calls`, () => replayUnitCalls(unitLists));
});

const unitCell = (value: number, dim: Record<string, number>, display?: string, ratio?: true): UnitCell =>
  ({ __unitCell: true, value, dim, ...(display === undefined ? {} : { display }), ...(ratio ? { ratio } : {}) });
/** Families of cells that share a dimension, so most lists aggregate and some mix. */
const UNIT_FAMILIES: UnitCell[][] = [
  [unitCell(5000, { length: 1 }, "km"), unitCell(1.5, { length: 1 }), unitCell(0.3048, { length: 1 }, "ft"), unitCell(-1609.344, { length: 1 }, "mi"), unitCell(-0, { length: 1 }, "km")],
  [unitCell(293.15, { temperature: 1 }, "degC"), unitCell(255.3722222222222, { temperature: 1 }, "degF"), unitCell(300, { temperature: 1 }, "K"), unitCell(310.15, { temperature: 1 }, "degC")],
  [unitCell(5, { currency: 1 }, "usd"), unitCell(7.25, { currency: 1 }, "usd"), unitCell(3, { currency: 1 }, "eur"), unitCell(2, { currency: 1 })],
  [unitCell(2.5, {}, undefined, true), unitCell(0.5, {}, undefined, true)],
  [unitCell(-0.25, { length: 1, time: -1 }, "ms1"), unitCell(3, { time: -1, length: 1 })],
  [unitCell(3, { "custom:widget": 1 }), unitCell(1e21, { "custom:widget": 1 }), unitCell(NaN, { "custom:widget": 1 })],
  [unitCell(7200, { time: 1 }, "h"), unitCell(90, { time: 1 }, "min"), unitCell(Infinity, { time: 1 }, ""), unitCell(12, { mass: 1, length: 2, time: -2 }, "J")],
  [unitCell(2, { length: 2 }), unitCell(4, { length: 2, "custom:b": 0 }), unitCell(1, { mass: 1, length: 1, time: -2 })],
];

/** RUNNING over plain lists and lists with a unit ([[C25]] firstClassUnits): the core reads each display unit's scale
 *  and offset from the wire (`unit_lists.rs`). */
const unitRunning = frozen<UnitListCase>("unit-running", () => {
  const cases: UnitListCase[] = [];
  const rand = mulberry32(5151);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const plain = [1, -2.5, 0, -0, 3, 1e308, NaN, Infinity, null, undefined, "4", "", true, solError("#N/A", "gone"), [1, 2]];
  for (let i = 0; i < 6000; i++) {
    const fam = pick(UNIT_FAMILIES);
    const mode = rand();
    const cell = () => (mode < 0.25 ? pick(plain) : rand() < 0.75 ? pick(fam) : rand() < 0.15 ? pick(pick(UNIT_FAMILIES)) : pick(plain));
    const list = rand() < 0.05 ? cell() : Array.from({ length: Math.floor(rand() * 7) }, cell);
    const op = pick(["SUM", "AVERAGE", "avg", " min ", "MAX", "MEDIAN", "PRODUCT", "STDEV", "mode", null]);
    const args = rand() < 0.3 ? [op, list] : [op, list, pick([0, 1, 2, 3, 2.5, 0.4, 0.6, -1, 10, null, NaN, "2"])];
    let want: unknown;
    try { want = unitData(resolveExcelFunction("RUNNING")!(...structuredClone(args))); } catch (e) { want = { thrown: String((e as Error).message ?? e) }; }
    cases.push({ name: "RUNNING", args, want });
  }
  return cases;
});

describe("RUNNING over values with a unit answers as frozen", () => {
  it(`${unitRunning.length} calls`, () => replayUnitCalls(unitRunning));
});

/** SORT, SORTBY, UNIQUE, TAKE and DROP over lists and tables holding values with a unit ([[C25]] firstClassUnits): a
 *  unit cell sorts after the logicals and ties with its kind, and UNIQUE keys it by base magnitude and dimension. */
const unitShapers = frozen<UnitListCase>("unit-shapers", () => {
  const cases: UnitListCase[] = [];
  const rand = mulberry32(6262);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const same = [unitCell(5000, { length: 1 }, "km"), unitCell(5000, { length: 1 }), unitCell(5000.0000000000001, { length: 1 }, "m"),
    unitCell(5000, { time: 1 }), unitCell(-0, { length: 1 }), unitCell(0, { length: 1 }, "km"), unitCell(NaN, { length: 1 }),
    unitCell(Infinity, { length: 1 }), unitCell(1, { length: 1, time: -1 }), unitCell(1, { time: -1, length: 1 }), unitCell(1.1, {}, undefined, true),
    unitCell(3960, { time: 1 }, "h"), unitCell(1.1 * 3600, { time: 1 }), unitCell(2, { "custom:é": 1, "custom:z": 1 }), unitCell(2, { "custom:z": 1, "custom:é": 1 })];
  const cell = () => (rand() < 0.5 ? pick(same) : rand() < 0.4 ? pick(pick(UNIT_FAMILIES)) : pick([1, 2, -1, 0, null, undefined, "a", "b", true, false, NaN, solError("#N/A", "gone")]));
  const row = (n: number) => Array.from({ length: n }, cell);
  const data = (): unknown => {
    const r = rand();
    if (r < 0.1) return cell();
    if (r < 0.55) return row(Math.floor(rand() * 7));
    const w = 1 + Math.floor(rand() * 3);
    return Array.from({ length: 1 + Math.floor(rand() * 5) }, () => row(w));
  };
  const setting = () => pick([undefined, null, 1, 2, -1, 0, true, false, ...same.slice(0, 2)]);
  for (let i = 0; i < 5000; i++) {
    const name = pick(["SORT", "SORT", "UNIQUE", "UNIQUE", "SORTBY", "TAKE", "DROP"]);
    const v = data();
    const args = name === "SORT" ? [v, pick([undefined, 1, 2]), pick([undefined, 1, -1]), pick([undefined, false, true])]
      : name === "UNIQUE" ? [v, pick([undefined, false, true]), pick([undefined, false, true])]
      : name === "SORTBY" ? [v, !Array.isArray(v) ? cell() : Array.isArray(v[0]) ? v.map(() => [cell()]) : row(v.length), pick([undefined, 1, -1])]
      : [v, setting(), pick([undefined, 1, -1])];
    let want: unknown;
    try { want = unitData(resolveExcelFunction(name)!(...structuredClone(args))); } catch (e) { want = { thrown: String((e as Error).message ?? e) }; }
    cases.push({ name, args, want });
  }
  return cases;
});

describe("SORT and UNIQUE over values with a unit answer as frozen", () => {
  it(`${unitShapers.length} calls`, () => replayUnitCalls(unitShapers));
});

/** FILTER over values with a unit ([[C25]] firstClassUnits): the data moves unread, and a unit cell read as a
 *  condition is `#VALUE!` (`ifTest`). */
const unitFilters = frozen<UnitListCase>("unit-filters", () => {
  const cases: UnitListCase[] = [];
  const rand = mulberry32(7373);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const cell = () => (rand() < 0.5 ? pick(pick(UNIT_FAMILIES)) : pick([1, 2, -1, 0, null, undefined, "a", true, false, NaN, solError("#N/A", "gone")]));
  const cond = () => (rand() < 0.15 ? pick(pick(UNIT_FAMILIES)) : pick([true, false, true, 1, 0, -2, NaN, null, undefined, "TRUE", "false", "x", "", solError("#N/A", "gone")]));
  const row = (n: number, f: () => unknown) => Array.from({ length: n }, f);
  for (let i = 0; i < 4000; i++) {
    const r = rand();
    const w = 1 + Math.floor(rand() * 3);
    const v: unknown = r < 0.1 ? cell() : r < 0.55 ? row(Math.floor(rand() * 7), cell) : row(1 + Math.floor(rand() * 5), () => row(w, cell));
    const n = !Array.isArray(v) ? 1 : Array.isArray(v[0]) ? v.length : v.length;
    const include = rand() < 0.1 ? cond()
      : Array.isArray(v) && Array.isArray(v[0]) ? (rand() < 0.8 ? v.map(() => [cond()]) : row(w, cond))
      : row(rand() < 0.9 ? n : n + 1, cond);
    const args = rand() < 0.5 ? [v, include] : [v, include, pick([undefined, null, 0, "none", ...pick(UNIT_FAMILIES)])];
    let want: unknown;
    try { want = unitData(resolveExcelFunction("FILTER")!(...structuredClone(args))); } catch (e) { want = { thrown: String((e as Error).message ?? e) }; }
    cases.push({ name: "FILTER", args, want });
  }
  return cases;
});

describe("FILTER over values with a unit answers as frozen", () => {
  it(`${unitFilters.length} calls`, () => replayUnitCalls(unitFilters));
});

type ExprUnitCase = { src: string; env: Record<string, unknown>; want: unknown };

/** Expression's unit wrapper ([[C25]] firstClassUnits, unit-flow § Expression): the dimension check, the one shared
 *  display unit the formula reads its numbers in, the point weight over readings and the result's unit, frozen from
 *  `ExpressionNode.data()` over generated inputs with a unit. */
const expressionUnits = frozen<ExprUnitCase>("expression-units", () => {
  const cases: ExprUnitCase[] = [];
  const rand = mulberry32(8484);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const extra = [unitCell(1000, { length: 1 }, "km"), unitCell(2000, { length: 1 }, "km"), unitCell(283.15, { temperature: 1 }, "degC"),
    unitCell(303.15, { temperature: 1 }, "degC"), unitCell(10, { currency: 1 }, "eur"), unitCell(3600, { time: 1 }, "km"),
    unitCell(0.5, { length: 1 }, "custom"), unitCell(4, { length: 1 }, ""), unitCell(1e-9, { length: 1 }, "km"), unitCell(0.1 + 0.2, { length: 1 }, "ft")];
  const plain = [1, 2, -3, 0.5, 0, 10, null, "x", "", true, NaN];
  const family = () => pick([...UNIT_FAMILIES, extra, extra]);
  const binary = ["+", "-", "*", "/", "^", ">", "<=", "=", "&"];
  const leafOf = (vars: string[]) => (rand() < 0.75 ? pick(vars) : pick(["2", "0.5", "1", "3600", "100", "-1", '"a"']));
  const exprOf = (vars: string[], depth: number): string => {
    if (depth === 0 || rand() < 0.3) return leafOf(vars);
    const r = rand();
    const a = exprOf(vars, depth - 1);
    if (r < 0.55) {
      const op = pick(binary);
      const b = op === "^" ? pick(["2", "0.5", "3", "-1", leafOf(vars)]) : exprOf(vars, depth - 1);
      return `(${a} ${op} ${b})`;
    }
    const fn = pick(["SUM", "AVERAGE", "MIN", "MAX", "ABS", "SQRT", "ROUND", "IF", "COUNT", "MEDIAN", "STDEV", "INDEX", "LET", "MAP", "PRODUCT"]);
    if (fn === "ROUND") return `ROUND(${a}, ${pick(["0", "1", "2"])})`;
    if (fn === "IF") return `IF(${exprOf(vars, 0)} > ${exprOf(vars, 0)}, ${a}, ${exprOf(vars, depth - 1)})`;
    if (fn === "INDEX") return `INDEX(${a}, 1)`;
    if (fn === "LET") return `LET(q, ${a}, q ${pick(["+", "*", "-"])} ${exprOf(vars, 0)})`;
    if (fn === "MAP") return `MAP(${a}, LAMBDA(v, v ${pick(["*", "+", "/"])} ${pick(["2", "v", exprOf(vars, 0)])}))`;
    if (["ABS", "SQRT"].includes(fn)) return `${fn}(${a})`;
    return `${fn}(${a}${rand() < 0.5 ? `, ${exprOf(vars, depth - 1)}` : ""})`;
  };
  for (let i = 0; i < 6000; i++) {
    const fam = family();
    const cell = () => (rand() < 0.8 ? pick(fam) : rand() < 0.5 ? pick(plain) : pick(family()));
    const value = (): unknown => {
      const r = rand();
      if (r < 0.7) return cell();
      if (r < 0.95) return Array.from({ length: 1 + Math.floor(rand() * 4) }, cell);
      return Array.from({ length: 2 }, () => [cell(), cell()]);
    };
    const vars = ["a", "b", "c", "xs"].slice(0, 1 + Math.floor(rand() * 4));
    const src = exprOf(vars, 1 + Math.floor(rand() * 3));
    const node = new ExpressionNode({ expr: src });
    const env: Record<string, unknown> = {};
    for (const v of node.varNames) env[v] = rand() < 0.1 ? pick(plain) : value();
    const inputs: Record<string, unknown[]> = {};
    for (const v of node.varNames) inputs[v] = [structuredClone(env[v])];
    let want: unknown;
    try { want = unitData(node.data(inputs).result); } catch (e) { want = { thrown: String((e as Error).message ?? e) }; }
    cases.push({ src, env, want });
  }
  return cases;
});

describe("Expression's unit wrapper answers as frozen", () => {
  it(`${expressionUnits.length} formulas`, () => {
    const bad: unknown[] = [];
    for (const c of expressionUnits) {
      const env = Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, coreValue(v, true)]));
      const r = readReply(wasmInvokeSync<unknown>("engine_expression_units", { src: c.src, env, clock: engineClock() }));
      const got = r ? unitData(r.value) : { bailed: true };
      if (JSON.stringify(enc(got)) !== JSON.stringify(enc(c.want))) bad.push({ src: c.src, env: c.env, got, want: c.want });
    }
    if (process.env.CORE_DUMP) fs.writeFileSync(process.env.CORE_DUMP, `${bad.length} differ\n` + bad.map((b) => JSON.stringify(enc(b))).join("\n"));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

if (FREEZING) {
  it("froze every suite", () => {
    expect(bodies.length + maths.length + columns.length + verbs.length + frameFns.length + expressions.length + unitDims.length + affineCases.length + unitLists.length + unitRunning.length + unitShapers.length + unitFilters.length + expressionUnits.length).toBeGreaterThan(0);
  });
}
// Kept for the differential suites' imports until they go: these names are also the core's to answer.
void FORMULA_FNS;

// ─── Pack functions called back from the core (external.rs) ─────────────────────────

type PackCase = { src: string; env: Record<string, unknown>; want: unknown };

/** Formulas calling the built-in packs' functions, alone and inside the core's own functions and LAMBDA hosts: the core
 *  evaluates the arguments and calls the TS back for each pack call. */
const packCalls = frozen<PackCase>("pack-calls", () => {
  initPackFormulas();
  const cases: PackCase[] = [];
  const rand = mulberry32(4242);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const PACK: (() => string)[] = [
    () => `PHYSICSCONSTANT(${pick(['"c"', '"G"', '"h"', '"kb"', '"nope"', "1", "t", ""])})`,
    () => `ELEMENT(${pick(['"Fe"', "26", '"Xx"', "x", "0", "119"])}${pick(["", ', "mass"', ', "name"', ", ", ', "nope"', ", t"])})`,
    () => `MOLARMASS(${pick(['"H2O"', '"CuSO4·5H2O"', '"Zz"', "5", "t", '""'])})`,
    () => `ISIN(${pick(["xs", "ts", "{1,2,3}", "x"])}, ${pick(["{1,2}", "xs", '{"a","x"}', "y"])})`,
    () => `TALLY(${pick(["xs", "ts", "{1,1,2}", "x"])})`,
    () => `PARALLELCOMBINE(${pick(["xs", "x, y", "y", "10, 10, 5", "x, 0", "xs, y"])})`,
    () => `COLEBROOK(${pick(["1e5", "x", "2000", "-1"])}, ${pick(["0.001", "y", "0", ""])})`,
    () => `PIPEROUGHNESS(${pick(['"pvc"', '"steel"', '"glass?"', "x"])})`,
    () => `STANDARDATMOSPHERE(${pick(["1000", "x", "-500", "90000"])}${pick(["", ', "pressure"', ', "temperature"', ', "density"', ', "nope"', ", "])})`,
    () => `ANTOINE(${pick(['"water"', '"ethanol"', '"unobtainium"', "x"])}, ${pick(["50", "x", "-300", "y"])})`,
    () => `SUNRISE(${pick(["45000", "x", "45100.5"])}, ${pick(["51.5", "78", "-33.9", "y"])}, ${pick(["0", "151.2", "y"])})`,
    () => `DAYLENGTH(${pick(["45000", "45180", "x"])}, ${pick(["51.5", "78", "0"])}, 0)`,
    () => `MOONPHASE(${pick(["45000", "x", "45015"])}${pick(["", ', "phase"', ', "illumination"', ', "age"', ", "])})`,
    () => `SUNPOSITION(${pick(["45000.5", "x"])}, ${pick(["51.5", "y"])}, ${pick(["0", "-0.1"])}${pick(["", ', "azimuth"', ', "elevation"'])})`,
    () => `AWGWIRE(${pick(["12", "x", "0", "40", "-3"])}${pick(["", ', "diameter"', ', "area"', ', "resistance"'])})`,
    () => `ESERIESVALUE(${pick(["4.6", "x", "1000", "0"])}${pick(["", ', "E12"', ', "E96"', ", y"])})`,
    () => `RESISTORCOLORCODE(${pick(["1", '"brown"', "x"])}, ${pick(["0", '"black"', "y"])}, ${pick(["2", '"red"', "3"])}, ${pick(["5", '"gold"', "10"])})`,
    () => `EMSPECTRUMBAND(${pick(["5e14", "x", "1e20", ""])}${pick(["", ", 5e-7", ", y"])})`,
    () => `HEARTRATEZONES(${pick(["190", "x", "150"])}${pick(["", ", 60", ", y"])})`,
    () => `TRIANGLESOLVER(${pick(["3, 4, 5", "3, 4, , , , 90", "x, y, 5", "1, 1, 3", ", , , 60, 60, 60"])})`,
  ];
  const wrap = (inner: string): string => pick([
    inner, inner, `ROUND(${inner}, 3)`, `IFERROR(${inner}, -1)`, `x * ${inner}`, `SUM(${inner})`, `${inner} & "!"`,
    `MAP(xs, LAMBDA(v, ${inner.replace(/\bx\b/g, "v")}))`, `IF(y > 1, ${inner}, 0)`, `INDEX(${inner}, 1)`, `COUNT(${inner})`,
    `LET(q, ${inner}, q)`, `${inner} + ${pick(PACK)()}`,
  ]);
  for (let i = 0; i < 3000; i++) {
    const env: Record<string, unknown> = {
      x: pick([3, -1.5, 0, 45000, null, "7", true, 12]), y: pick([2, 0.5, -4, 10, 60]),
      xs: pick([[1, 2, 3], [4, -2, 0, 9], [], [1.5, null, 3], [5], [10, 20]]),
      t: pick(["c", "Fe", "", "water", "H2O"]), ts: pick([["a", "b", "a"], ["x"], ["10", "9", "x"]]),
    };
    const src = wrap(pick(PACK)());
    const ev = compileTsEvaluator(src);
    if (!ev) continue;
    let want: unknown;
    try { want = canon(ev(structuredClone(env))); } catch (e) { want = isSolError(e) ? canon(e) : { thrown: String((e as Error).message ?? e) }; }
    if (JSON.stringify(want).includes('"other"')) continue;
    cases.push({ src, env, want });
  }
  return cases;
});

describe("pack functions answer as frozen, called back from the core", () => {
  it(`${packCalls.length} formulas`, { timeout: 600_000 }, () => {
    initPackFormulas();
    syncExternalNames();
    let ran = 0;
    const bad: unknown[] = [];
    for (const c of packCalls) {
      const raw = wasmInvokeSync<{ bail?: boolean } | null>("engine_eval", { src: c.src, env: Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, wire(v)])), clock: engineClock() });
      if (raw && raw.bail) continue;
      ran++;
      const got = engineAnswer("", raw);
      if (JSON.stringify(got) !== JSON.stringify(c.want)) bad.push({ src: c.src, env: c.env, got, want: c.want });
    }
    expect(bad.slice(0, 5)).toEqual([]);
    checkBails("pack calls", packCalls.length - ran);
  });
});

describe("a computed column calls a pack function back from the core", () => {
  it("row by row, as the TS computes it", () => {
    initPackFormulas();
    const src = "PARALLELCOMBINE(@a, 10) + COUNT(TALLY(a))";
    const f: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: [10, 20, null, 5, -1] }] };
    const core = computeColumnOnEngine(f, src, 5);
    const ts = computeColumnCells(f, { kind: "expr", evaluator: compileTsEvaluator(src)!, vars: extractVariables(src) });
    expect(core).not.toBeNull();
    expect(core).toEqual(ts);
  });
});
