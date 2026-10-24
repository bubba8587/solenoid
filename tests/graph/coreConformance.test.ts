// [[C130]] rustCore, [[D99]] rustIsSpec
// The Rust core against its frozen answers (coreFixtures.ts): the fixtures are the spec, and one changes only in the
// commit that changes the behaviour, by FREEZE_CORE=<suite> answering the frozen cases again through the core.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { isSolError } from "../../src/graph/errorValue";
import { isCx } from "../../src/graph/cxValue";
import { parseFormula } from "../../src/graph/excelFormula";
import { frameRowCount, type FrameValue } from "../../src/graph/frame";
import type { FrameOp, JoinOpts } from "../../src/graph/frameOps";
import { isUnitCell } from "../../src/graph/unitValue";
import { coreValue, readReply } from "../../src/graph/coreValues";
import { frameBackend, useWasmBackend, computeColumnOnEngine, engineClock, frameFnOnCore } from "../../src/graph/frameBackend";
import { ReduceLambdaNode, ByAxisNode } from "../../src/graph/nodes/tableLambda";
import { isLambdaValue, type LambdaValue } from "../../src/graph/lambdaValue";
import { wasmInvokeSync } from "../../src/graph/engineWasm";
import { readFrozen, replay, freezes, writeFrozen, enc } from "./coreFixtures";

// TODAY and NOW read the clock: one moment, in UTC, both when the cases were made and when they replay.
process.env.TZ = "UTC";
vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 5, 15, 13, 45, 30, 250) });

beforeAll(() => {
  useWasmBackend();
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wf = (t: string) => (t as string & { toWellFormed(): string }).toWellFormed();
const bits = (x: number) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(); };
const isNanBits = (b: string) => (BigInt(b) & 0x7ff0000000000000n) === 0x7ff0000000000000n && (BigInt(b) & 0xfffffffffffffn) !== 0n;
const failed = (name: string) => ({ err: "#VALUE!", msg: `${name} can't compute with these arguments` });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A JS value as comparable data. */
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

/** The core's reply as comparable data: a JavaScript exception is #VALUE!, as a formula's call reads it. */
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
const wireEnv = (env: Record<string, unknown>) => Object.fromEntries(Object.entries(env).map(([k, v]) => [k, wire(v)]));

// ─── Function bodies ──────────────────────────────────────────────────────────────

type FnCase = { name: string; args: unknown[]; want: unknown };
const bodies = readFrozen<FnCase>("function-bodies");

describe("function bodies answer as frozen", () => {
  const byName = new Map<string, FnCase[]>();
  for (const c of bodies) (byName.get(c.name) ?? byName.set(c.name, []).get(c.name)!).push(c);
  for (const [name, cases] of [...byName].sort(([a], [b]) => (a < b ? -1 : 1))) {
    it(`${name} (${cases.length})`, () => {
      for (const c of cases) {
        const got = engineAnswer(name, wasmInvokeSync("engine_call", { name, args: c.args.map(wire), clock: engineClock() }));
        if (freezes("function-bodies")) c.want = got;
        else if (!same(got, c.want)) expect({ name, args: c.args, got }).toEqual({ name, args: c.args, got: c.want });
      }
    });
  }
  if (freezes("function-bodies")) it("writes the frozen bodies", () => writeFrozen("function-bodies", bodies));
});

// ─── V8's Math ────────────────────────────────────────────────────────────────────

type MathCase = { fn: string; xs: number[]; ys: number[]; want: string[] };
const MATH_FNS = ["exp", "log", "log10", "pow", "sin", "cos", "tan", "asin", "acos", "atan", "acosh", "atanh", "log1p", "atan2", "expm1", "tanh", "log2", "prec15"];

/** V8's Math is the live reference, so these answers are made fresh each run rather than frozen. */
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
const lamValue = (w: LamWire): LambdaValue => ({ __lambda: true, params: w.params, expr: w.expr, captured: w.captured, capturedValues: w.capturedValues,
  fn: () => { throw new Error("a frozen LAMBDA runs on the core"); } } as LambdaValue);

describe("computed columns answer as frozen", () => {
  const columns = readFrozen<ColCase>("columns");
  it(`${columns.length} formulas`, { timeout: 600_000 }, () => {
    const bad = replay("columns", columns, (c) => {
      const lambdas = c.lambdas && Object.fromEntries(Object.entries(c.lambdas).map(([k, w]) => [k, lamValue(w)]));
      const sideValue = (p: string) => (p in c.sides ? c.sides[p] : { __solError: true, code: "#REF!", message: `No column "${p}"` });
      const rows = c.frame.columns.reduce((m, col) => Math.max(m, col.values.length), 0);
      const engine = c.bare
        ? computeColumnOnEngine(c.frame, "", rows, { bare: lamValue(c.bare), sideValue })
        : computeColumnOnEngine(c.frame, c.src, rows, { sideValue, reserved: c.reserved, lambdas });
      if (engine === null) return { none: true };
      return isSolError(engine) ? { error: { code: engine.code, message: wf(engine.message) } } : { cells: cellView(engine.cells), sideVars: engine.sideVars };
    });
    expect(bad).toEqual([]);
  });
});

// ─── Table verbs ──────────────────────────────────────────────────────────────────

type Outcome = { frame: unknown } | { error: { code: string; message: string } };
type VerbCase = { kind: "unary"; frame: FrameValue; ops: FrameOp[]; want: Outcome } | { kind: "binary"; which: number; l: FrameValue; r: FrameValue; opts: JoinOpts; want: Outcome };

function view(f: FrameValue): unknown {
  return f.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map((v) => (isSolError(v) ? { err: v.code, msg: wf(v.message) } : typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v)) }));
}

describe("table verbs answer as frozen", () => {
  const verbs = readFrozen<VerbCase>("verbs");
  it(`${verbs.length} pipelines, joins, appends and binds`, { timeout: 600_000 }, async () => {
    const be = frameBackend();
    const bad: unknown[] = [];
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
      if (freezes("verbs")) c.want = got;
      else if (!same(got, c.want)) bad.push({ c, got });
    }
    if (freezes("verbs")) writeFrozen("verbs", verbs);
    expect(bad.slice(0, 3)).toEqual([]);
  });
});

// ─── Frame functions (frame_fns.rs) ─────────────────────────────────────────────────

type FrameFnCase = { name: string; frames: FrameValue[]; args: unknown[]; want: unknown };

/** A frame function's answer as comparable data: a frame, a value, or a frame with a value beside it. */
function fnOutcome(name: string, frames: FrameValue[], args: unknown[]): unknown {
  try {
    const r = frameFnOnCore(name, frames, args);
    if (!r) return { none: true };
    if ("frame" in r) return "value" in r ? { frame: view(r.frame), value: canon(r.value) } : { frame: view(r.frame) };
    return { value: canon(r.value) };
  } catch (e) {
    return isSolError(e) ? { error: { code: e.code, message: wf(e.message) } } : { error: { code: "thrown", message: String(e) } };
  }
}

describe("frame functions answer as frozen", () => {
  const frameFns = readFrozen<FrameFnCase>("frame-fns");
  it(`${frameFns.length} calls`, { timeout: 600_000 }, () => {
    expect(replay("frame-fns", frameFns, (c) => fnOutcome(c.name, c.frames, c.args), same)).toEqual([]);
  });

  it("an error in a Decision Matrix's Weight cell is its answer", () => {
    const f: FrameValue = { __frame: true, columns: [
      { name: "name", type: "string", values: ["A", "B"] },
      { name: "quality", type: "number", values: [1, 2] },
      { name: "cost", type: "number", values: [3, 4] },
    ] };
    const w: FrameValue = { __frame: true, columns: [
      { name: "criterion", type: "string", values: ["quality", "cost"] },
      { name: "weight", type: "number", values: [3, { __solError: true, code: "#DIV/0!", message: "boom" }] },
    ] };
    expect(fnOutcome("decisionMatrix", [f, w], ["none", false])).toMatchObject({ error: { code: "#DIV/0!" } });
  });
});

// ─── Formulas over values (the Expression card) ───────────────────────────────────

type ExprCase = { src: string; env: Record<string, unknown>; want: unknown };

const evalAnswer = (c: ExprCase) => engineAnswer("", wasmInvokeSync("engine_eval", { src: c.src, env: wireEnv(c.env), clock: engineClock() }));

describe("formulas over values answer as frozen", () => {
  const expressions = readFrozen<ExprCase>("expressions");
  it(`${expressions.length} formulas`, { timeout: 600_000 }, () => {
    expect(replay("expressions", expressions, evalAnswer, same)).toEqual([]);
  });
});

// ─── Pack functions (fns_packs.rs) ───────────────────────────────────────────────

describe("pack functions answer as frozen", () => {
  const packCalls = readFrozen<ExprCase>("pack-calls");
  it(`${packCalls.length} formulas`, { timeout: 600_000 }, () => {
    expect(replay("pack-calls", packCalls, evalAnswer, same)).toEqual([]);
  });

  it("a computed column calls one row by row", () => {
    const a = [10, 20, null, 5, -1];
    const f: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: a }] };
    const core = computeColumnOnEngine(f, "PARALLELCOMBINE(@a, 10) + COUNT(TALLY(a))", 5);
    // A blank this-row cell is a missing argument, which a whole-list function answers blank.
    expect(core).toEqual({ cells: a.map((x) => (x === null ? null : 1 / (1 / x + 1 / 10) + 4)), sideVars: [] });
  });
});

// ─── Formula dimensions (unit_dims.rs) ───────────────────────────────────────────

type DimCase = { src: string; env: Record<string, Record<string, number>>; codes: Record<string, string>; want: unknown };
type DimFnsCase = DimCase & { fns: Record<string, [string[], string]> };

const dimAnswer = (raw: { dim?: unknown; code?: unknown }) => (raw.dim ? { dim: raw.dim, code: raw.code } : raw);

describe("formula dimensions answer as frozen", () => {
  const unitDims = readFrozen<DimCase>("unit-dims");
  it(`${unitDims.length} formulas, as text and as a tree`, () => {
    // As text, and as the tree a caller with no text (Equation's isolated side) sends.
    expect(replay("unit-dims", unitDims, (c) => dimAnswer(wasmInvokeSync("engine_dim_eval", { src: c.src, env: c.env, codes: c.codes })), same)).toEqual([]);
    const trees = unitDims.filter((c) => !same(dimAnswer(wasmInvokeSync("engine_dim_eval", { ast: parseFormula(c.src), env: c.env, codes: c.codes })), c.want));
    expect(trees.slice(0, 5)).toEqual([]);
  });

  const unitDimsFns = readFrozen<DimFnsCase>("unit-dims-fns");
  it(`${unitDimsFns.length} formulas through named LAMBDAs`, () => {
    expect(replay("unit-dims-fns", unitDimsFns, (c) => dimAnswer(wasmInvokeSync("engine_dim_eval", { src: c.src, env: c.env, codes: c.codes, fns: c.fns })), same)).toEqual([]);
    const trees = unitDimsFns.filter((c) => {
      const fns = Object.fromEntries(Object.entries(c.fns).map(([k, [ps, body]]) => [k, [ps, parseFormula(body)]]));
      return !same(dimAnswer(wasmInvokeSync("engine_dim_eval", { ast: parseFormula(c.src), env: c.env, codes: c.codes, fns })), c.want);
    });
    expect(trees.slice(0, 5)).toEqual([]);
  });
});

type AffCase = { src: string; points: string[]; lists: string[]; bare: string[]; fns: Record<string, [string[], string]>; want: unknown };

// The formula trees the editor's walkers read (variables, LaTeX, steps), first frozen from the TypeScript parser.
describe("the parser answers its frozen trees", () => {
  const trees = readFrozen<{ src: string; want: unknown }>("formula-trees");
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v;
  it(`${trees.length} formulas`, () => {
    const parse = (src: string) => (src.trim() ? sorted(wasmInvokeSync("engine_formula_parse", { expr: src })) : null);
    expect(replay("formula-trees", trees, (c) => parse(c.src), (a, b) => same(a, sorted(b)))).toEqual([]);
  });
});

describe("affine weights answer as frozen", () => {
  const affineCases = readFrozen<AffCase>("affine-weights");
  it(`${affineCases.length} formulas, as text and as a tree`, () => {
    const ask = (c: AffCase, formula: unknown, fns: unknown) => wasmInvokeSync<unknown>("engine_affine_weight", { ...(formula as object), points: c.points, lists: c.lists, bare: c.bare, fns });
    expect(replay("affine-weights", affineCases, (c) => ask(c, { src: c.src }, c.fns), same)).toEqual([]);
    const trees = affineCases.filter((c) => {
      const fns = Object.fromEntries(Object.entries(c.fns).map(([k, [ps, body]]) => [k, [ps, parseFormula(body)]]));
      return !same(ask(c, { ast: parseFormula(c.src) }, fns), c.want);
    });
    expect(trees.slice(0, 5)).toEqual([]);
  });
});

// ─── Bodies over values with a unit ───────────────────────────────────────────────

type UnitListCase = { name: string; args: unknown[]; want: unknown };

/** A value with its unit cells spelled out, so frozen and replayed answers compare as data. */
function unitData(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unitData);
  if (isUnitCell(v)) return { __u: v.value, dim: Object.keys(v.dim).sort().map((k) => [k, v.dim[k]]), display: v.display ?? null, ratio: v.ratio ?? false };
  return v;
}

const unitCall = (c: UnitListCase) => {
  const r = readReply(wasmInvokeSync<unknown>("engine_call", { name: c.name, args: c.args.map((a) => coreValue(a, true)), clock: engineClock() }));
  return r ? unitData(r.value) : { unread: true };
};

describe("bodies over values with a unit answer as frozen", () => {
  for (const [suite, what] of [["unit-lists", "the list movers"], ["unit-running", "RUNNING"], ["unit-shapers", "SORT, SORTBY, UNIQUE, TAKE and DROP"], ["unit-filters", "FILTER"]] as const) {
    const cases = readFrozen<UnitListCase>(suite);
    it(`${what} (${cases.length})`, () => expect(replay(suite, cases, unitCall)).toEqual([]));
  }
});

type ExprUnitCase = { src: string; env: Record<string, unknown>; want: unknown };

describe("Expression's unit wrapper answers as frozen", () => {
  const expressionUnits = readFrozen<ExprUnitCase>("expression-units");
  it(`${expressionUnits.length} formulas`, () => {
    expect(replay("expression-units", expressionUnits, (c) => {
      const env = Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, coreValue(v, true)]));
      const r = readReply(wasmInvokeSync<unknown>("engine_expression_units", { src: c.src, env, order: Object.keys(c.env), clock: engineClock() }));
      return r ? unitData(r.value) : { unread: true };
    })).toEqual([]);
  });
});

type FoldCase = { kind: "reduce" | "row" | "col"; src: string; m: unknown; initial?: unknown; wrapped: boolean; want: unknown };

describe("REDUCE, BYROW and BYCOL over values with a unit answer as frozen", () => {
  const foldUnits = readFrozen<FoldCase>("fold-units");
  /** A table socket's reading: a list is one row, a scalar one cell. */
  const toAnyMatrix = (v: unknown) => (v == null ? null : !Array.isArray(v) ? [[v]] : v.length && !Array.isArray(v[0]) ? [v] : v);
  it(`${foldUnits.length} folds through the nodes' data()`, () => {
    expect(replay("fold-units", foldUnits, (c) => {
      const node = c.kind === "reduce" ? new ReduceLambdaNode({ expr: c.src }) : new ByAxisNode({ expr: c.src, op: c.kind });
      const inputs = { table: [structuredClone(c.m)], ...(c.initial === undefined ? {} : { initial: [structuredClone(c.initial)] }) };
      try { return unitData(node.data(inputs).result); } catch (e) { return { thrown: String((e as Error).message ?? e) }; }
    })).toEqual([]);
  });
  it("the wrapper alone, where the nodes run it", () => {
    const bad: unknown[] = [];
    for (const c of foldUnits) {
      if (!c.wrapped) continue;
      const r = readReply(wasmInvokeSync<unknown>("engine_fold_units", { kind: c.kind, src: c.src, m: coreValue(toAnyMatrix(c.m), true),
        initial: c.initial === undefined ? 0 : coreValue(c.initial, true), clock: engineClock() }));
      const got = r ? unitData(r.value) : { unread: true };
      if (JSON.stringify(enc(got)) !== JSON.stringify(enc(c.want))) bad.push({ kind: c.kind, src: c.src, m: c.m, initial: c.initial, got, want: c.want });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// ─── The core's per-site caches ───────────────────────────────────────────────────

describe("the core's per-site caches never answer one call from another's entry", () => {
  const f: FrameValue = { __frame: true, columns: [{ name: "xs", type: "number", values: [1, 2, 3] }, { name: "n", type: "number", values: [2, 3, 4] }] };
  it("a range memo inside one LAMBDA body isn't read by another's", () => {
    const src = 'CONCAT(MAP(SEQUENCE(1),LAMBDA(x,MAX(xs))),"|",MAP(SEQUENCE(1),LAMBDA(y,SUM(xs))))';
    const g: FrameValue = { __frame: true, columns: [{ name: "r", type: "number", values: Array.from({ length: 40 }, (_, i) => i) }] };
    const sideValue = (name: string) => (name === "xs" ? [1, 2, 3] : undefined);
    const core = computeColumnOnEngine(g, src, 40, { sideValue } as never);
    expect(core && !isSolError(core) && core.cells).toEqual(Array(40).fill("3|6"));
  });
  it("a call site's blank slots stay its own", () => {
    const src = 'MAP(SEQUENCE(1),LAMBDA(x,POWER(5,))) & "," & MAP(SEQUENCE(1),LAMBDA(y,POWER(5,@n)))';
    expect(computeColumnOnEngine(f, src, frameRowCount(f))).toEqual({ cells: ["1,25", "1,125", "1,625"], sideVars: [] });
  });
});
