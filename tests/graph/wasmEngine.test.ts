// [[C130]] rustCore, [[D97]] tsIsSpec, [[D98]] wholeColumnFallback
// The Rust engine (crates/solenoid-core) in WebAssembly against the JS oracle, through the real backend wrapper:
// the parity corpus, then seeded random frames under random verbs. The oracle is the spec, so every difference,
// a cell, an error's code or message, or a thrown error, is a Rust bug.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyVerb, joinFrames, appendFrames, bindColumns, pivotFrame, type FrameOp, type JoinOpts, type PivotSpec, type AggOp } from "../../src/graph/frameVerbs";
import { pivotLayoutOf } from "../../src/graph/pivotLayout";
import type { ColumnUnit } from "../../src/graph/unitValue";
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "../../src/graph/frame";
import { isSolError, solError, type SolErrorCode } from "../../src/graph/errorValue";
import { frameBackend, useWasmBackend, resetFrameBackendToJs, pivotOnEngine, computeColumnOnEngine, runFrameUnary, readFrame, isFrameRef, engineClock } from "../../src/graph/frameBackend";
import { ComputedColumnNode } from "../../src/graph/nodes/frame";
import { parseFormula, compileEvaluator, extractVariables, rowRefNames } from "../../src/graph/excelFormula";
import { resolveExcelFunction } from "../../src/graph/excelFunctions";
import { computeColumnCells } from "../../src/graph/computedColumnCore";
import { loadWasmEngineSync, wasmInvokeSync } from "../../src/graph/engineWasm";

const WASM = path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm");
const CORPUS_DIR = path.resolve(__dirname, "../../fixtures/frame-verbs");

// TODAY and NOW read the clock on both sides: frozen, they read the same moment.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 5, 15, 13, 45, 30, 250) });
  loadWasmEngineSync(fs.readFileSync(WASM));
  useWasmBackend();
});
afterAll(() => {
  resetFrameBackendToJs();
  vi.useRealTimers();
});

type Outcome = { frame: unknown } | { error: { code: string; message: string } };

/** Cells as comparable data: -0 is 0 (JSON drops the sign on the way in), an error is its code and message. */
function view(f: FrameValue): unknown {
  return f.columns.map((c) => ({
    name: c.name, type: c.type,
    values: c.values.map((v) => {
      if (typeof v === "number" && Object.is(v, -0)) return 0;
      if (typeof v === "number" && Number.isNaN(v)) return "NaN";
      if (isSolError(v)) return { err: v.code, msg: v.message };
      return v;
    }),
  }));
}

function caught(e: unknown): Outcome {
  if (isSolError(e)) return { error: { code: e.code, message: e.message } };
  throw e;
}

function oracle(run: () => FrameValue): Outcome {
  try { return { frame: view(run()) }; } catch (e) { return caught(e); }
}

async function engine(frames: FrameValue[], run: (handles: string[]) => Promise<string>): Promise<Outcome> {
  const be = frameBackend();
  const handles: string[] = [];
  try {
    for (const f of frames) handles.push(await be.source(f));
    const out = await run(handles);
    return { frame: view(await be.collect(out as never)) };
  } catch (e) {
    return caught(e);
  } finally {
    wasmInvokeSync("engine_clear");
  }
}

const runUnary = (f: FrameValue, ops: FrameOp[]) => ({
  oracle: () => oracle(() => ops.reduce((acc, op) => applyVerb(acc, op), f)),
  engine: () => engine([f], ([h]) => frameBackend().applyMany(h as never, ops)),
});

// ─── The corpus ─────────────────────────────────────────────────────────────────

interface WireColumn { name: string; type: FrameColType; values: unknown[] }
interface CorpusCase { name: string; frames: Record<string, { columns: WireColumn[] }>; op: { kind: string } & Record<string, unknown> }

const decode = (v: unknown): FrameCell => {
  const o = v as { __nf?: string; __err?: string } | null;
  if (o?.__nf) return o.__nf === "inf" ? Infinity : o.__nf === "-inf" ? -Infinity : NaN;
  if (typeof o?.__err === "string") return solError(o.__err as SolErrorCode, "corpus");
  return v as FrameCell;
};
const brand = (w: { columns: WireColumn[] }): FrameValue =>
  ({ __frame: true, columns: w.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map(decode) })) });

const corpus = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json")).sort()
  .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), "utf8")) as { verb: string; cases: CorpusCase[] }).cases
    .map((c) => [`${f.replace(".json", "")}: ${c.name}`, c] as const));

describe("the Rust engine answers the corpus as the oracle does", () => {
  it.each(corpus)("%s", async (_name, kase) => {
    const frames = Object.fromEntries(Object.entries(kase.frames).map(([k, w]) => [k, brand(w)]));
    const { kind, ...rest } = kase.op;
    let pair: { oracle: () => Outcome; engine: () => Promise<Outcome> };
    if (kind === "join") {
      pair = {
        oracle: () => oracle(() => joinFrames(frames.left, frames.right, rest as unknown as JoinOpts)),
        engine: () => engine([frames.left, frames.right], ([l, r]) => frameBackend().join(l as never, r as never, rest as unknown as JoinOpts)),
      };
    } else if (kind === "append" || kind === "bindColumns") {
      const fs_ = (rest.frames as string[]).map((n) => frames[n]);
      pair = {
        oracle: () => oracle(() => (kind === "append" ? appendFrames(fs_) : bindColumns(fs_))),
        engine: () => engine(fs_, (hs) => (kind === "append" ? frameBackend().append(hs as never) : frameBackend().bindColumns(hs as never))),
      };
    } else {
      pair = runUnary(frames.in, kind === "pipeline" ? (rest.ops as FrameOp[]) : [kase.op as unknown as FrameOp]);
    }
    expect(await pair.engine()).toEqual(pair.oracle());
  });
});

// ─── Random frames under random verbs ───────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["a", "b", "c", "k", "A", "é", "𝒳", "Col1", " v ", "value"];
const TEXT = ["x", "X", "apple", "Apple", "", "  ", "10", "1,000", "2.5", "true", "FALSE", "é", "É", "", "😀", "a b", "zz", "\u212A", "İstanbul", "ΣΑΣ", "straße", "\uFFFD", "\u{1F600}x"];
const TYPES: FrameColType[] = ["number", "string", "logical", "date"];

function gen(rand: () => number) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const cell = (type: FrameColType): FrameCell => {
    const r = rand();
    if (r < 0.1) return null;
    if (r < 0.14) return solError(pick(["#DIV/0!", "#N/A", "#VALUE!"] as const), "fuzz");
    switch (type) {
      case "string": return pick(TEXT);
      case "logical": return r < 0.16 ? 2 : rand() < 0.5;
      case "date": return int(45000, 45010);
      default: {
        if (r < 0.18) return pick([NaN, Infinity, -Infinity, -0, 1e308, -1e308]);
        return rand() < 0.6 ? int(-3, 5) : Math.round(rand() * 2000 - 1000) / 8;
      }
    }
  };
  const frame = (): FrameValue => {
    const ncols = int(1, 5);
    const rows = int(0, 9);
    const names = [...NAMES].sort(() => rand() - 0.5).slice(0, ncols);
    const columns: FrameColumn[] = names.map((name) => {
      const type = pick(TYPES);
      const len = rand() < 0.1 ? int(0, rows) : rows;
      return { name, type, values: Array.from({ length: len }, () => cell(type)) };
    });
    return { __frame: true, columns };
  };
  const colOf = (f: FrameValue) => (rand() < 0.05 ? "missing" : f.columns.length ? pick(f.columns).name : "none");
  const some = (f: FrameValue) => f.columns.filter(() => rand() < 0.5).map((c) => c.name);
  const valueFor = (f: FrameValue, col: string): FrameCell => {
    const c = f.columns.find((x) => x.name === col);
    if (c && c.values.length && rand() < 0.6) return pick(c.values);
    return cell(c?.type ?? "number");
  };
  const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "startsWith", "endsWith", "isblank", "notblank", "iserror", "noterror", "listContains"];
  const AGGS = ["sum", "avg", "min", "max", "count", "product", "median", "mode", "stdev", "stdevp", "var", "varp", "percentof"];
  const WINDOW = ["row_number", "rank", "dense_rank", "percent_rank", "ntile", "cumsum", "cumavg", "cummin", "cummax", "cumcount",
    "lag", "lead", "diff", "pct_change", "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
    "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last"];
  const cond = (f: FrameValue) => {
    const column = colOf(f);
    return { column, op: pick(FILTER_OPS), value: valueFor(f, column), ...(rand() < 0.3 ? { matchCase: true } : {}) };
  };
  const op = (f: FrameValue): FrameOp => {
    const scale = () => (rand() < 0.15 ? { readingScale: pick([1, 5 / 9]) } : {});
    switch (int(0, 13)) {
      case 0: return { kind: "select", columns: [colOf(f), ...some(f)] };
      case 1: return { kind: "drop", columns: some(f) };
      case 2: return { kind: "rename", map: Object.fromEntries(some(f).map((n) => [n, pick(NAMES)])) };
      case 3: return { kind: "sort", by: colOf(f), dir: pick(["asc", "desc"] as const) };
      case 4: return { kind: "distinct", ...(rand() < 0.5 ? { columns: some(f) } : {}) };
      case 5: return { kind: "head", n: int(-1, 12) };
      case 6: { const c = cond(f); return { kind: "filter", column: c.column, op: c.op as never, value: c.value, ...(c.matchCase ? { matchCase: true } : {}) }; }
      case 7: return { kind: "filterMulti", combine: pick(["and", "or"] as const), conditions: Array.from({ length: int(0, 3) }, () => cond(f)) as never, complement: rand() < 0.3 };
      case 8: return {
        kind: "groupBy", keys: some(f),
        aggs: Array.from({ length: int(0, 3) }, () => ({ column: colOf(f), op: pick(AGGS) as never, as: pick(NAMES), ...scale(), ...(rand() < 0.1 ? { unitScale: 1000 } : {}) })),
      };
      case 9: {
        const ids = some(f);
        const type = f.columns.length ? pick(f.columns).type : "number";
        return { kind: "unpivot", idColumns: ids, valueColumns: f.columns.filter((c) => !ids.includes(c.name) && (c.type === type || rand() < 0.1)).map((c) => c.name), ...(rand() < 0.3 ? { variableName: pick(NAMES) } : {}) };
      }
      case 10: return {
        kind: "window", partitionBy: some(f), ...(rand() < 0.7 ? { orderBy: colOf(f), orderDir: pick(["asc", "desc"] as const) } : {}),
        fn: pick(WINDOW) as never, column: colOf(f), as: pick([...NAMES, ""]), ...(rand() < 0.6 ? { n: int(0, 4) } : {}), ...scale(),
      };
      case 11: return { kind: "fillBlanks", columns: some(f), dir: pick(["down", "up"] as const) };
      case 12: return { kind: "replaceValues", column: rand() < 0.3 ? "" : colOf(f), find: pick([...TEXT, "1", "TRUE", "-3"]), replaceWith: pick([...TEXT, "0", "7"]), mode: pick(["cell", "substring"] as const) };
      default: return { kind: "sliceRows", mode: pick(["first", "last", "skip", "range"] as const), n: int(-1, 10), ...(rand() < 0.5 ? { to: int(-1, 10) } : {}) };
    }
  };
  const join = (l: FrameValue, r: FrameValue): JoinOpts => ({
    leftKey: colOf(l), rightKey: colOf(r), how: pick(["inner", "left", "right", "outer", "cross", "semi", "anti", "asof"] as const),
    ...(rand() < 0.4 ? { asofDirection: pick(["backward", "forward", "nearest"] as const) } : {}),
    ...(rand() < 0.3 ? { asofTolerance: int(0, 3) } : {}),
    ...(rand() < 0.15 ? { rightKeyScale: pick([1, 1000, 0.001]), rightKeyOffset: pick([0, 273.15]) } : {}),
  });
  return { frame, op, join, int };
}

// FUZZ_RUNS and FUZZ_SEED widen a run by hand: `FUZZ_RUNS=200000 FUZZ_SEED=7 npx vitest run tests/graph/wasmEngine.test.ts`.
const FUZZ_RUNS = Number(process.env.FUZZ_RUNS ?? 3000);
const FUZZ_SEED = Number(process.env.FUZZ_SEED ?? 0);

describe("random frames: the Rust engine matches the oracle", () => {
  it(`${FUZZ_RUNS} single-frame pipelines`, { timeout: 600_000 }, async () => {
    const g = gen(mulberry32(20261021 + FUZZ_SEED));
    for (let i = 0; i < FUZZ_RUNS; i++) {
      const f = g.frame();
      const ops: FrameOp[] = [];
      let shape = f;
      for (let k = g.int(1, 3); k > 0; k--) {
        const op = g.op(shape);
        ops.push(op);
        try { shape = applyVerb(shape, op); } catch { break; }
      }
      const pair = runUnary(f, ops);
      const want = pair.oracle();
      const got = await pair.engine();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        console.log(JSON.stringify({ input: view(f), ops }));
        expect({ run: i, input: view(f), ops, got }).toEqual({ run: i, input: view(f), ops, got: want });
      }
    }
  });

  it(`${FUZZ_RUNS} joins, appends and binds`, { timeout: 600_000 }, async () => {
    const g = gen(mulberry32(42 + FUZZ_SEED));
    for (let i = 0; i < FUZZ_RUNS; i++) {
      const l = g.frame(), r = g.frame();
      const which = g.int(0, 2);
      const opts = g.join(l, r);
      const want = oracle(() => (which === 0 ? joinFrames(l, r, opts) : which === 1 ? appendFrames([l, r]) : bindColumns([l, r])));
      const got = await engine([l, r], ([a, b]) =>
        which === 0 ? frameBackend().join(a as never, b as never, opts)
          : which === 1 ? frameBackend().append([a, b] as never) : frameBackend().bindColumns([a, b] as never));
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ run: i, which, l: view(l), r: view(r), opts, got }).toEqual({ run: i, which, l: view(l), r: view(r), opts, got: want });
      }
    }
  });
});

describe("random pivots: the Rust engine matches the oracle, layout and units included", () => {
  const AGGS: AggOp[] = ["sum", "avg", "min", "max", "count", "product", "median", "mode", "stdev", "var", "varp", "percentof"];
  const UNITS: ColumnUnit[] = [{ dim: { length: 1 }, display: "km" }, { dim: { temperature: 1 }, display: "°C" }, { dim: { temperature: 1 }, display: "°F" }];
  const full = (f: FrameValue | null) => f && {
    cells: view(f),
    units: f.columns.map((c) => c.unit ?? null),
    layout: pivotLayoutOf(f) && JSON.parse(JSON.stringify(pivotLayoutOf(f), (_k, v) => (typeof v === "number" && Number.isNaN(v) ? "NaN" : v))),
  };
  it(`${FUZZ_RUNS} pivots`, { timeout: 600_000 }, () => {
    const rand = mulberry32(777 + FUZZ_SEED);
    const g = gen(rand);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let i = 0; i < FUZZ_RUNS; i++) {
      const f = g.frame();
      for (const c of f.columns) if (c.type === "number" && rand() < 0.3) c.unit = pick(UNITS);
      const names = f.columns.map((c) => c.name);
      const few = () => names.filter(() => rand() < 0.35);
      const values = rand() < 0.05 ? [] : names.filter(() => rand() < 0.5).concat(rand() < 0.03 ? ["missing"] : []);
      const spec: PivotSpec = {
        rowFields: few(), colFields: few(), values: values.length ? values : [pick(names)],
        funcs: Array.from({ length: g.int(0, 3) }, () => pick(AGGS)),
        ...(rand() < 0.5 ? { rowTotalDepth: g.int(-3, 3) } : {}),
        ...(rand() < 0.5 ? { colTotalDepth: g.int(-3, 3) } : {}),
        ...(rand() < 0.5 ? { rowSort: g.int(-5, 5) } : {}),
        ...(rand() < 0.5 ? { colSort: g.int(-5, 5) } : {}),
        ...(rand() < 0.5 ? { relativeTo: g.int(0, 5) } : {}),
        ...(rand() < 0.3 ? { filter: f.columns[0]?.values.map(() => pick([true, false, null])) ?? [] } : {}),
      };
      // NaN in a field the pivot sorts by makes JS's comparator inconsistent, where JS engines themselves disagree.
      for (const c of f.columns) if ([...spec.rowFields, ...spec.colFields].includes(c.name)) c.values = c.values.map((v) => (Number.isNaN(v) ? null : v));
      let want: unknown, got: unknown;
      try { want = { ok: full(pivotFrame(f, spec)) }; } catch (e) { want = caught(e); }
      try { got = { ok: full(pivotOnEngine(f, spec)) }; } catch (e) { got = caught(e); }
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ run: i, input: view(f), units: f.columns.map((c) => c.unit ?? null), spec, got }).toEqual({ run: i, input: view(f), units: f.columns.map((c) => c.unit ?? null), spec, got: want });
      }
    }
  });
});

// ─── The formula language ──────────────────────────────────────────────────────

const FNS = ["IF", "IFS", "AND", "OR", "NOT", "IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE",
  "ISBLANK", "ISNUMBER", "ISTEXT", "ISLOGICAL", "ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC", "INT", "ABS", "SIGN",
  "SQRT", "EXP", "LN", "LOG10", "MOD", "POWER", "QUOTIENT", "SUM", "MIN", "MAX", "AVERAGE", "MEDIAN", "PRODUCT",
  "STDEV", "STDEV.S", "STDEV.P", "VAR", "VAR.S", "VAR.P", "LEN", "CONCAT", "CONCATENATE", "MID", "LEFT", "RIGHT",
  "UPPER", "LOWER", "TRIM", "REPT", "SUBSTITUTE", "YEAR", "MONTH", "DAY", "TEXT", "VLOOKUP", "XLOOKUP", "SEQUENCE",
  "PI", "EXACT", "FIND", "XOR", "COUNT", "COUNTA", "COUNTBLANK", "ISEVEN", "ISODD", "ISNONTEXT", "N", "T", "CHOOSE", "DATE",
  "SIN", "COS", "TAN", "ATAN", "SINH", "COSH", "TANH", "ASINH", "COT", "COTH", "ACOT", "ACOTH", "SEC", "SECH", "CSC",
  "CSCH", "DEGREES", "RADIANS", "LOG", "ATAN2", "SQRTPI", "ASIN", "ACOS", "ACOSH", "ATANH",
  "HOUR", "MINUTE", "SECOND", "EOMONTH", "WEEKDAY", "WEEKNUM", "ISOWEEKNUM", "DAYS", "TIME",
  "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
  "MODE", "MODE.SNGL", "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF",
  "SEARCH", "PROPER", "CHAR", "UNICHAR", "CODE", "UNICODE", "VALUE", "TEXTJOIN",
  "CEILING", "CEILING.MATH", "FLOOR", "FLOOR.MATH", "MROUND", "EVEN", "ODD", "SWITCH", "REPLACE",
  "DATEDIF", "DAYS360", "YEARFRAC", "DATETRUNC", "FROMEPOCH", "TOEPOCH", "WORKDAY", "WORKDAY.INTL", "NETWORKDAYS",
  "NETWORKDAYS.INTL", "XMATCH",
  "AVEDEV", "GEOMEAN", "HARMEAN", "DEVSQ", "SKEW", "SKEW.P", "KURT", "PTP", "IQR", "MAD", "SEM", "CV", "RMS",
  "CORREL", "PEARSON", "RSQ", "KENDALL", "COVAR", "COVARIANCE.P", "COVARIANCE.S", "SLOPE", "INTERCEPT", "STEYX",
  "RANK", "RANK.EQ", "RANK.AVG", "TRIMMEAN", "PERCENTRANK", "PERCENTRANK.INC", "PERCENTRANK.EXC", "GCD", "LCM",
  "CLAMP", "BETWEEN", "ISBOOLEAN", "ISCLOSE", "HYPOTENUSE", "NAND", "NOR", "XNOR", "STANDARDIZE", "FISHER", "SLN",
  "ORDINAL", "TEXTBEFORE", "TEXTAFTER", "REVERSETEXT", "PADTEXT", "TRUNCATETEXT", "NUMBERVALUE",
  "PMT", "FV", "PV", "NPER", "IPMT", "PPMT",
  "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "CHISQ.DIST", "CHISQ.INV", "CHISQ.DIST.RT", "CHISQ.INV.RT",
  "F.DIST", "F.INV", "F.DIST.RT", "F.INV.RT", "T.DIST", "T.DIST.RT", "T.DIST.2T", "T.INV", "T.INV.2T", "GAMMA.DIST",
  "GAMMA.INV", "BETA.DIST", "BETA.INV", "LOGNORM.DIST", "LOGNORM.INV", "WEIBULL.DIST", "EXPON.DIST", "BINOM.DIST",
  "BINOM.INV", "POISSON.DIST", "HYPGEOM.DIST", "NEGBINOM.DIST",
  "WAVG", "WVAR", "WSTDEV", "COUNTDISTINCT", "ARGMAX", "ARGMIN", "LENGTH", "CONTAINS", "INDEX", "FIXED", "DATEVALUE", "TIMEVALUE",
  "TODAY", "NOW", "EDATE", "CONVERT", "SPEARMAN", "FORECAST.LINEAR", "T.TEST", "F.TEST", "PROB", "FISHERINV", "LOG2",
  "FACT", "FACTDOUBLE", "COMBIN", "COMBINA", "PERMUT", "PERMUTATIONA", "MULTINOMIAL", "SUMSQ", "SUMPRODUCT",
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "SERIESSUM", "BASE", "DECIMAL", "ROMAN", "ARABIC", "BIN2DEC", "BIN2HEX",
  "BIN2OCT", "DEC2BIN", "DEC2HEX", "DEC2OCT", "HEX2BIN", "HEX2DEC", "HEX2OCT", "OCT2BIN", "OCT2DEC", "OCT2HEX",
  "BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT", "DELTA", "GESTEP", "TYPE", "ERF", "ERF.PRECISE", "ERFC",
  "ERFC.PRECISE", "GAMMA", "GAMMALN", "GAMMALN.PRECISE", "Z.TEST", "CHISQ.TEST", "ROW", "VALUETOTEXT", "NA", "GAUSS", "PHI",
  "CONFIDENCE.NORM", "BINOM.DIST.RANGE", "CLEAN", "DB", "DDB", "SYD", "EFFECT", "NOMINAL", "PDURATION", "RRI", "ISPMT",
  "DOLLARDE", "DOLLARFR", "FISHEREXACT", "PROPTEST", "BINOMTEST", "FORECAST", "VLOOKUP", "NOSUCHFN", "GETCOLUMN"];
/** These sort their numbers, and a NaN among them makes JS's comparator inconsistent, where JS engines disagree. */
/** Text built `new Array(n).join` long: a literal like 3e9 asks Formula.js for gigabytes, slow on the TS side alone; the bodies are checked directly. */
const FORMULA_FNS = FNS.filter((n) => !/^(ROMAN|BASE|DEC2|HEX2|OCT2|BIN2)/.test(n));
const SORTS_NUMBERS = /LARGE|SMALL|PERCENTILE|QUARTILE|TRIMMEAN|PERCENTRANK|SPEARMAN/i;
const OPS = ["+", "-", "*", "/", "^", "&", "=", "<>", "<", ">", "<=", ">="];

function formulaGen(rand: () => number) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const lit = () => pick(["0", "1", "2", "-0", "3.5", "1e3", ".5", "10", "100", "1e308", "0.1", "7", "45000.75", "-700000", "3e9", "45291.999",
    "45351", "60", "36", "11", "4"]);
  const str = () => `"${pick(["", "abc", "ABC", "TRUE", "false", "5", " a  b ", "😀x", "é", "1,000", "x", "#N/A", ">5", "<>abc", "a*", "?b?", "~*", "*", "<=0", ">=1e3", "<>", "=", "<x", "2024-01-15",
    "2024-02-30", "05/01/2024", "13/01/2024", "3-Apr-2026", "2024-13", ">2024-01-01", "=TRUE", "<>FALSE", "=12", "AB*", "hello wORLD", "o'neil-x2y", "(1,234.5)", "$5%", "-$3", "ÉCOLE éa", "ǅx", "0000011", "1111111", "ms", " S ", "month", "q", "YM", "md", "yd", "week_sun"])}"`;
  const ref = () => pick(["@a", "@b", "@c", "@d", "[@a]", "@[b]", "[@[c]]", "@nope", "a", "pi", "E", "Tau", "s1", "@s2", "[@s1]", "s3", "@name", "b", "c", "d", "[a]", "[b]", "[d]", "[nope]"]);
  const expr = (depth: number): string => {
    const r = rand();
    if (depth <= 0 || r < 0.3) return pick([lit, str, ref, ref, () => pick(["TRUE", "FALSE", "true"])])();
    if (r < 0.4) return `${pick(["-", "+"])}${expr(depth - 1)}`;
    if (r < 0.45) return `${expr(depth - 1)}%`;
    if (r < 0.65) return `${expr(depth - 1)} ${pick(OPS)} ${expr(depth - 1)}`;
    if (r < 0.7) return `(${expr(depth - 1)})`;
    const name = pick(FORMULA_FNS);
    const n = Math.floor(rand() * 4);
    const args = Array.from({ length: n }, () => (rand() < 0.15 ? "" : expr(depth - 1)));
    return `${rand() < 0.2 ? name.toLowerCase() : name}(${args.join(", ")})`;
  };
  return expr;
}

describe("the Rust formula parser matches the TS one", () => {
  it(`${FUZZ_RUNS * 5} random formulas, well-formed and not`, () => {
    const rand = mulberry32(9001 + FUZZ_SEED);
    const expr = formulaGen(rand);
    const NOISE = ["(", ")", ",", "[", "]", "@", "\"", "e", ".", "1", " ", "λ", "+", "<", ">", "=", "%", "x.y", "[@", "]]"];
    for (let i = 0; i < FUZZ_RUNS * 5; i++) {
      let s = expr(3);
      if (rand() < 0.3) {
        const at = Math.floor(rand() * (s.length + 1));
        s = s.slice(0, at) + NOISE[Math.floor(rand() * NOISE.length)] + s.slice(at + (rand() < 0.5 ? 1 : 0));
      }
      if (!(s as string & { isWellFormed(): boolean }).isWellFormed()) continue;
      const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
        x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x);
      const want = canon(parseFormula(s));
      const got = canon(wasmInvokeSync("engine_formula_parse", { expr: s }));
      if (got !== want) expect({ s, got }).toEqual({ s, got: want });
    }
  });
});

describe("random row formulas: the Rust evaluator matches the TS one", () => {
  // Rust strings can't hold half a surrogate pair (RIGHT("😀", 1)); it reads as U+FFFD, as it does on screen.
  const wf = (t: string) => (t as string & { toWellFormed(): string }).toWellFormed();
  const well = (v: unknown) => (typeof v === "string" ? wf(v) : isSolError(v) ? { ...v, message: wf(v.message) } : v);
  it(`${FUZZ_RUNS * 3} computed columns`, { timeout: 600_000 }, () => {
    const rand = mulberry32(4242 + FUZZ_SEED);
    const g = gen(rand);
    const expr = formulaGen(rand);
    let ran = 0;
    for (let i = 0; i < FUZZ_RUNS * 3; i++) {
      const rows = g.int(0, 6);
      const cell = (type: FrameColType): FrameCell => {
        const r = rand();
        if (r < 0.1) return null;
        if (r < 0.15) return solError(rand() < 0.5 ? "#N/A" : "#DIV/0!", "fuzz");
        if (type === "number") return r < 0.22 ? [NaN, Infinity, -Infinity, -0, 1e300][Math.floor(rand() * 5)] : Math.round(rand() * 400 - 200) / 8;
        if (type === "string") return ["", "abc", "Abc", " x ", "12", "TRUE", "😀", "é", "true", "a*c", "ab", "xbx"][Math.floor(rand() * 12)];
        if (type === "logical") return rand() < 0.5;
        return 40000 + Math.floor(rand() * 9000);
      };
      const f: FrameValue = {
        __frame: true,
        columns: (["a:number", "b:string", "c:logical", "d:date"] as const).map((s) => {
          const [name, type] = s.split(":") as [string, FrameColType];
          return { name, type, values: Array.from({ length: rows }, () => cell(type)) };
        }),
      };
      const src = expr(3);
      if (SORTS_NUMBERS.test(src)) f.columns[0].values = f.columns[0].values.map((v) => (Number.isNaN(v) ? null : v));
      const sideVals: Record<string, unknown> = { s1: cell("number"), s2: cell("string"), s3: [1, 2], nope: cell("logical") };
      const opts = { sideValue: (p: string) => sideVals[p], reserved: ["name"] };
      const engine = computeColumnOnEngine(f, src, rows, opts);
      if (engine === null) continue;
      ran++;
      const evaluator = compileEvaluator(src)!;
      const js = computeColumnCells(f, { kind: "expr", evaluator, vars: extractVariables(src) }, { ...opts, rowRefs: rowRefNames(src) });
      const want = isSolError(js) ? js : [view({ __frame: true, columns: [{ name: "out", type: "number", values: js.cells.map(well) as FrameCell[] }] }), js.sideVars];
      const got = [view({ __frame: true, columns: [{ name: "out", type: "number", values: engine.cells }] }), engine.sideVars];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        expect({ run: i, src, input: view(f), got }).toEqual({ run: i, src, input: view(f), got: want });
      }
    }
    expect(ran, "the generator should reach the Rust evaluator often").toBeGreaterThan(FUZZ_RUNS / 2);
  });
});

describe("the Rust engine's fdlibm matches V8's Math bit for bit", () => {
  it("toPrecision(15), exact ties included", () => {
    const rand = mulberry32(2718 + FUZZ_SEED);
    const xs: number[] = [];
    for (let i = 0; i < FUZZ_RUNS * 10; i++) {
      const k = Math.floor(rand() * 1e15) * 10 + 5;
      const r = rand();
      xs.push(r < 0.3 ? k / 2 ** Math.floor(rand() * 8) : r < 0.6 ? (rand() - 0.5) * 10 ** Math.floor(rand() * 40 - 20) : Math.round(rand() * 1e6) / 1024 * 1.2);
    }
    const got = wasmInvokeSync<string[]>("engine_math", { fn: "prec15", xs });
    const bits = (x: number) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(); };
    const bad = xs.filter((x, i) => bits(Number(x.toPrecision(15))) !== got[i]).slice(0, 3);
    expect(bad).toEqual([]);
  });

  it.each(["exp", "log", "log10", "pow", "sin", "cos", "tan", "asin", "acos", "atan", "acosh", "atanh", "log1p", "atan2", "expm1", "tanh", "log2"])("%s", (fn) => {
    const rand = mulberry32(31337 + FUZZ_SEED);
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < FUZZ_RUNS * 10; i++) {
      const nice = rand() < 0.5;
      const x = fn === "asin" || fn === "acos" || fn === "atanh" ? (nice ? Math.round(rand() * 200 - 100) / 100 : rand() * 2 - 1)
        : fn === "acosh" ? 1 + (nice ? Math.round(rand() * 1e4) / 100 : 10 ** (rand() * 12 - 6))
        : fn === "log1p" ? (nice ? Math.round(rand() * 1e4) / 100 - 0.99 : 10 ** (rand() * 20 - 10) - 0.5)
        : fn === "sin" || fn === "cos" || fn === "tan" || fn === "atan" || fn === "atan2" ? (nice ? Math.round(rand() * 1e5) / 100 - 500 : (rand() - 0.5) * 10 ** Math.floor(rand() * 40 - 10))
        : fn === "exp" ? (nice ? Math.round(rand() * 1400 - 700) / 4 : rand() * 1400 - 700)
        : fn === "expm1" || fn === "tanh" ? (nice ? Math.round(rand() * 1600 - 800) / 8 : (rand() - 0.5) * 10 ** Math.floor(rand() * 24 - 20))
        : fn === "pow" ? (nice ? Math.round(rand() * 400) / 10 : rand() * 50)
        : (nice ? Math.round(rand() * 1e4) / 8 : Math.exp(rand() * 300 - 150));
      // engine_math takes plain JSON numbers, which carry no -0.
      xs.push(x + 0);
      ys.push((nice ? Math.round(rand() * 60 - 30) / 2 : rand() * 60 - 30) + 0);
    }
    const math = { exp: Math.exp, log: Math.log, log10: Math.log10, pow: Math.pow, sin: Math.sin, cos: Math.cos, tan: Math.tan,
      asin: Math.asin, acos: Math.acos, atan: Math.atan, acosh: Math.acosh, atanh: Math.atanh, log1p: Math.log1p, atan2: Math.atan2,
      expm1: Math.expm1, tanh: Math.tanh, log2: Math.log2 }[fn as "exp"] as (a: number, b?: number) => number;
    const bits = (x: number) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(); };
    const got = wasmInvokeSync<string[]>("engine_math", { fn, xs, ys });
    const bad = xs.map((x, i) => [x, ys[i], math(x, ys[i]), got[i]] as const)
      .filter(([, , want, g]) => !(Number.isNaN(want) ? (BigInt(g) & 0x7ff0000000000000n) === 0x7ff0000000000000n : bits(want) === g));
    expect(bad.slice(0, 3)).toEqual([]);
  });
});

describe("whole-column aggregates run on the Rust evaluator and match", () => {
  const f: FrameValue = {
    __frame: true,
    columns: [
      { name: "a", type: "number", values: [3, null, -1.5, 8, 0] },
      { name: "b", type: "string", values: ["x", "", null, "Yo", "z"] },
      { name: "c", type: "logical", values: [true, false, null, true, true] },
      { name: "d", type: "number", values: [1, 2, solError("#N/A", "gap"), 4, 5] },
    ],
  };
  it.each([
    "@a / SUM(a)", "MAX([a]) - @a", "COUNTBLANK(b)", "AVERAGE(a, @a)", "CONCAT(b)", "AND(c)", "COUNT(d) + COUNTA(b)",
    "SUM(d)", "IFERROR(SUM(d), -1)", "MEDIAN(a) & \"|\" & @b", "PRODUCT([a], 2)", "XOR(c, @c)",
    "LARGE(a, 2)", "SMALL(a, @a)", "PERCENTILE(a, 0.3)", "QUARTILE.EXC(a, 1)", "MODE(a, 3)",
    "COUNTIF(b, @b)", "COUNTIF(b, \"?o\")", "COUNTIF(a, \">=0\")", "SUMIFS(a, b, \"<>\", c, TRUE)",
    "AVERAGEIF(a, \">0\")", "MAXIFS(d, a, \"<5\")", "MINIFS(a, b, \"*\")", "COUNTIFS(a, @a, c, @c)",
    "COUNTIF(a, \"2024-01-15\")", "COUNTIF(a, \"05/01/2024\")",
    "XLOOKUP(@b, b, a)", "XLOOKUP(@a + 1, a, d, \"none\")", "XMATCH(@a, a, 1)", "XMATCH(@a, a, -1, -1)",
    "SUM(a * d)", "SUM((a > 0) * a)", "AVERAGE(-a) + @a", "SUM(a%)", "COUNTIF(a * 2, \">5\")", "SUM(LEN(@b) * a)",
    "INDEX(a, 2)", "INDEX(d, XMATCH(@b, b))", "INDEX(a, 3, 1)", "INDEX(@a, 1)", "INDEX(b, 9)",
    "SUM(REPT(\"x\", a) = \"\")", "SUM(IF(a > 0, a, 0))", "SUM(LEN(b))", "COUNT(IFERROR(1 / a, \"x\"))", "SUM(ISERROR(d) * 1)", "MAX(ABS(a))",
    "SUM(ROUND(a, 0))", "WORKDAY(@d, 5, a)", "NETWORKDAYS(45000, @d, [a])", "SUM(ERROR.TYPE(d))", "SUM(IFNA(d, 0))",
    "SUM(a * [c])", "COUNTA(b & \"x\")", "SUM(a / (d - 40000))",
    "WAVG(a, d)", "WSTDEV(d, a)", "COUNTDISTINCT(b)", "ARGMAX(a) + ARGMIN(d)", "LENGTH(a)", "CONTAINS(b, @b)",
    "CORREL(a, d)", "SLOPE(d, a) * @a", "RANK(@a, a)", "PERCENTRANK(a, @a)", "TRIMMEAN(a, 0.2)", "KURT(a, d)", "GCD(5, @a)",
    "SUMSQ(a, @a)", "SUMPRODUCT(a, [a])", "SUMPRODUCT(a, d)", "SPEARMAN(a, a * a)", "FORECAST.LINEAR(@a, a * 2, a)",
    "T.TEST(a, a * a, 2, 3)", "T.TEST(a, -a, 1, 1)", "F.TEST(a, a * a)", "PROB(a, a / 10, 0, 5)", "SUMX2MY2(a, a + 1)",
    "SUMXMY2(a, a / 2)", "SERIESSUM(2, 1, 1, a)", "Z.TEST(a, 1)", "Z.TEST(a, @a, 2)", "CHISQ.TEST(a + 10, a * 0 + 12)",
    "MULTINOMIAL(a)", "MULTINOMIAL(2, 3, @d)", "TODAY() - @d", "NOW()", "CONVERT(@a, \"km\", \"mi\")",
  ])("%s", (src) => {
    const engine = computeColumnOnEngine(f, src, 5);
    expect(engine, "should run on the engine").not.toBeNull();
    const js = computeColumnCells(f, { kind: "expr", evaluator: compileEvaluator(src)!, vars: extractVariables(src) }, { rowRefs: rowRefNames(src) });
    expect(isSolError(js)).toBe(false);
    if (isSolError(js)) return;
    expect(view({ __frame: true, columns: [{ name: "o", type: "number", values: engine!.cells }] }))
      .toEqual(view({ __frame: true, columns: [{ name: "o", type: "number", values: js.cells }] }));
  });
});

describe("EDATE runs on the engine wherever a local midnight rounds to its own day", () => {
  it.each(["EDATE(@d, 13)", "EDATE(@d, -1)", "EDATE(@d + 0.5, 1)"])("%s", (src) => {
    const f: FrameValue = { __frame: true, columns: [{ name: "d", type: "date", values: [0, 1, 59, 60, 61, 45351, 45322, null] }] };
    const engine = computeColumnOnEngine(f, src, 8);
    if (!engineClock().midnightRounds || src.includes("0.5")) {
      expect(engine).toBeNull();
      return;
    }
    const js = computeColumnCells(f, { kind: "expr", evaluator: compileEvaluator(src)!, vars: extractVariables(src) }, { rowRefs: rowRefNames(src) });
    if (isSolError(js)) throw js;
    const sign = (c: unknown) => (Object.is(c, -0) ? "-0" : c);
    expect(engine!.cells.map(sign)).toEqual(js.cells.map(sign));
  });
});

describe("a reading the port leaves out sends the column to the TS", () => {
  // An INDEX that answers a whole column lands somewhere only the TS's broadcast reads.
  it.each(["COUNTIF(a, \"3-Apr-2026\")", "SUMIFS(a, a, \">=Jan 5 2024\")", "INDEX(a, 0, 1)", "INDEX(a, , )"])("%s", (src) => {
    const f: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: [45000, 46115] }] };
    expect(computeColumnOnEngine(f, src, 2)).toBeNull();
  });
});

describe("a computed column over a frame in the engine matches the value path", () => {
  it(`${FUZZ_RUNS / 10} nodes, refs in and out`, { timeout: 600_000 }, async () => {
    const rand = mulberry32(555 + FUZZ_SEED);
    const g = gen(rand);
    const expr = formulaGen(rand);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    let resident = 0;
    for (let i = 0; i < FUZZ_RUNS / 10; i++) {
      const rows = g.int(1, 6);
      const f: FrameValue = {
        __frame: true,
        columns: (["a:number", "b:string", "c:logical", "d:date"] as const).map((s) => {
          const [name, type] = s.split(":") as [string, FrameColType];
          const vals = Array.from({ length: rows }, (_, k) => (type === "number" ? k * 1.5 - 2 : type === "string" ? ["x", "Yo", "", null][k % 4] : type === "logical" ? k % 2 === 0 : 45000 + k));
          return { name, type, values: vals as FrameCell[], ...(name === "a" && rand() < 0.3 ? { unit: { dim: { length: 1 }, display: "km" } } : {}) };
        }),
      };
      const src = expr(2);
      const name = pick(["computed", "a", "Total (km)", "d", "new"]);
      const after = pick(["", "", "b", "nope"]);
      const setup = (n: ComputedColumnNode) => {
        n.stringLiterals.name = name;
        n.stringLiterals.after = after;
      };
      const run = async () => {
        const ref = await runFrameUnary(f, { kind: "sort", by: "a", dir: "desc" });
        const node = new ComputedColumnNode({ expr: src });
        setup(node);
        let out: unknown;
        try { out = (await node.data({ frame: [ref] } as never)).frame; } catch (e) { out = e; }
        const v = isFrameRef(out) ? await readFrame(out) : out;
        return isSolError(v) ? { error: v.code } : v && { cells: view(v as FrameValue), units: (v as FrameValue).columns.map((c) => c.unit ?? null) };
      };
      useWasmBackend();
      const before = wasmInvokeSync<number>("engine_count");
      const got = await run();
      if (wasmInvokeSync<number>("engine_count") > before) resident++;
      resetFrameBackendToJs();
      const want = await run();
      useWasmBackend();
      if (JSON.stringify(got) !== JSON.stringify(want)) expect({ i, src, got }).toEqual({ i, src, got: want });
    }
    expect(resident).toBeGreaterThan(0);
  });
});

describe("TEXT's toFixed and toExponential match V8's digits, exact ties included", () => {
  it(`${FUZZ_RUNS * 2} numbers`, () => {
    const rand = mulberry32(31337 + FUZZ_SEED);
    const fn = resolveExcelFunction("TEXT")!;
    for (let i = 0; i < FUZZ_RUNS * 2; i++) {
      const r = rand();
      const x = r < 0.4 ? (Math.floor(rand() * 1e6) + 0.5) / 2 ** Math.floor(rand() * 12) * (rand() < 0.5 ? -1 : 1)
        : r < 0.7 ? (rand() - 0.5) * 10 ** Math.floor(rand() * 40 - 20) : Math.round(rand() * 1e9) / 1000;
      const d = Math.floor(rand() * 12);
      const code = rand() < 0.5 ? `#,##0${d ? "." + "0".repeat(d) : ""}` : `0${d ? "." + "0".repeat(d) : ""}E+00`;
      const want = fn(x, code);
      const got = wasmInvokeSync<{ str?: string }>("engine_call", { name: "TEXT", args: [x, code] });
      if (got?.str !== want) expect({ x, code, got: got?.str }).toEqual({ x, code, got: want });
    }
  });
});

describe("ROUND, ROUNDUP and ROUNDDOWN match bit for bit at their boundaries", () => {
  it(`${FUZZ_RUNS * 3} values`, () => {
    const rand = mulberry32(1005 + FUZZ_SEED);
    const fns = ["ROUND", "ROUNDUP", "ROUNDDOWN"].map((n) => [n, resolveExcelFunction(n)!] as const);
    const bits = (x: unknown) => (typeof x === "number" ? new DataView(Float64Array.of(x).buffer).getBigUint64(0, true).toString() : JSON.stringify(x));
    for (let i = 0; i < FUZZ_RUNS * 3; i++) {
      const d = Math.floor(rand() * 8) - 2;
      const r = rand();
      // Halves, near-halves and near-integers at the digit being rounded, plus plain values.
      const base = Math.floor(rand() * 1e6) + (r < 0.3 ? 0.5 : r < 0.5 ? 0.5 + (rand() - 0.5) * 1e-12 : r < 0.7 ? (rand() - 0.5) * 1e-12 : rand());
      const v = (base / 10 ** d) * (rand() < 0.5 ? -1 : 1);
      for (const [name, fn] of fns) {
        const want = fn(v, d);
        const got = wasmInvokeSync<{ num?: string }>("engine_call", { name, args: [v, d] });
        const g = got?.num !== undefined ? new DataView(new BigUint64Array([BigInt(got.num)]).buffer).getFloat64(0, true) : got;
        if (bits(g) !== bits(want)) expect({ name, v, d, got: g }).toEqual({ name, v, d, got: want });
      }
    }
  });
});

describe("FIXED matches on near-ties and wide counts", () => {
  it(`${FUZZ_RUNS} values`, () => {
    const rand = mulberry32(2020 + FUZZ_SEED);
    const fn = resolveExcelFunction("FIXED")!;
    for (let i = 0; i < FUZZ_RUNS; i++) {
      const d = Math.floor(rand() * 14) - 4;
      const v = ((Math.floor(rand() * 1e7) + (rand() < 0.4 ? 0.5 : rand())) / 10 ** Math.floor(rand() * 8)) * (rand() < 0.5 ? -1 : 1);
      const args = [v, d, rand() < 0.3];
      const want = fn(...args);
      const got = wasmInvokeSync<{ str?: string }>("engine_call", { name: "FIXED", args });
      if (got?.str !== want) expect({ args, got: got?.str }).toEqual({ args, got: want });
    }
  });
});

describe("the distribution functions match bit for bit on realistic parameters", () => {
  const CASES: Array<[string, (r: () => number) => unknown[]]> = [
    ["NORM.DIST", (r) => [r() * 20 - 10, r() * 4 - 2, r() * 3, r() < 0.5]],
    ["NORM.INV", (r) => [r(), r() * 10, r() * 3]],
    ["NORM.S.DIST", (r) => [r() * 16 - 8, r() < 0.5]],
    ["NORM.S.INV", (r) => [r() ** 3]],
    ["T.DIST", (r) => [r() * 10 - 5, 1 + r() * 40, r() < 0.5]],
    ["T.INV", (r) => [r(), 1 + r() * 30]],
    ["T.INV.2T", (r) => [r(), 1 + r() * 30]],
    ["CHISQ.DIST", (r) => [r() * 30, 1 + r() * 20, r() < 0.5]],
    ["CHISQ.INV.RT", (r) => [r(), 1 + r() * 20]],
    ["F.DIST", (r) => [r() * 6, 1 + r() * 20, 1 + r() * 40, r() < 0.5]],
    ["F.INV", (r) => [r(), 1 + r() * 20, 1 + r() * 40]],
    ["GAMMA.DIST", (r) => [r() * 20, 0.2 + r() * 8, 0.2 + r() * 4, r() < 0.5]],
    ["GAMMA.INV", (r) => [r(), 0.2 + r() * 8, 0.2 + r() * 4]],
    ["BETA.DIST", (r) => [r(), 0.2 + r() * 6, 0.2 + r() * 6, r() < 0.5]],
    ["BETA.INV", (r) => [r(), 0.2 + r() * 6, 0.2 + r() * 6]],
    ["LOGNORM.DIST", (r) => [r() * 10, r() * 2 - 1, 0.1 + r() * 2, r() < 0.5]],
    ["WEIBULL.DIST", (r) => [r() * 5, 0.3 + r() * 4, 0.3 + r() * 4, r() < 0.5]],
    ["BINOM.DIST", (r) => [Math.floor(r() * 40), 40, r(), r() < 0.5]],
    ["BINOM.INV", (r) => [Math.floor(r() * 200), r(), r()]],
    ["POISSON.DIST", (r) => [Math.floor(r() * 30), r() * 20, r() < 0.5]],
    ["HYPGEOM.DIST", (r) => [Math.floor(r() * 10), 10, 20, 50, r() < 0.5]],
    ["NEGBINOM.DIST", (r) => [Math.floor(r() * 20), 1 + Math.floor(r() * 10), r(), r() < 0.5]],
  ];
  const bits = (x: unknown) => (typeof x === "number" ? (Number.isNaN(x) ? "NaN" : new DataView(Float64Array.of(x).buffer).getBigUint64(0, true).toString()) : JSON.stringify(x));
  it.each(CASES)("%s", (name, gen) => {
    const rand = mulberry32(4711 + FUZZ_SEED + name.length);
    const fn = resolveExcelFunction(name)!;
    for (let i = 0; i < FUZZ_RUNS / 10; i++) {
      const args = gen(rand);
      const want = fn(...args);
      const got = wasmInvokeSync<{ num?: string; err?: string } | null>("engine_call", { name, args });
      const g = got && got.num !== undefined ? new DataView(new BigUint64Array([BigInt(got.num)]).buffer).getFloat64(0, true) : got && got.err ? { code: got.err } : got;
      const w = isSolError(want) ? { code: want.code } : want;
      if (bits(g) !== bits(w)) expect({ name, args, got: g }).toEqual({ name, args, got: w });
    }
  });
});

describe("each ported function body matches its JS one on random arguments", () => {
  // The IFERROR family runs in the evaluator (applyErrorHandler), never through a registered body.
  // A refused name (blocked, a node's verb, unknown) answers before any body runs; the evaluator tests cover those.
  const PORTED = FNS.filter((n) => !["VLOOKUP", "SEQUENCE", "IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE", "FORECAST", "NOSUCHFN", "GETCOLUMN"].includes(n));
  const POOL: unknown[] = ["14:30", "2:05:09.5 pm", "12:00 AM", "9:7", " 23:59:59 ", "24:00", "1:60", "13:00 PM", "7:30a.m.",
    "2024-03-15", "2024-02-30", "03/15/2024", "05/06/2024", "2024-03", "15-Mar-2024", "1:2:3:4", "12:34.5", 0.3, 0.975, 1.96, 4, 20, 0.01, 0.99, 6, 30, 0.05, 0.004, 360, 12, -200000, 5000, "a-b-c", "-", "B", "left", " Both ", "center", "1.234,5", ",", ".", 21, 112, 3, 0.25, "x😀", "😀", "İstanbul", "1e3%", "0.00", "#,##0.0", "$0.00%", "0.0E+00", "00000", "yyyy-mm-dd", "0.", "General", "@", "mmm \"d\" 0", 0.125, 2.5, -1234567.891, 45000, 45351.5, 36, 60, 1, 2958465, -5, "0000011", "1010101", "ms", " S ", "Quarter", "YM", "md", "y", 11, 17,
    "hello wORLD", "o'neil-x2y", "(1,234.5)", " $5% ", "-$3", "1.2.3", "ÉCOLE éa", "ΣΑΣ", "привет мИР", "ǆemal ⅷx", "a~?b", 65, 128512, 0xd800, ">5", "<>abc", "a*", "?B?", "~*", "<=0", "<>", "=", "2024-01-15", "05/01/2024", "=TRUE", undefined, null, 0, -0, 1, 2, -1, 0.5, -2.5, 3.75, 7, 10, 45000.25, 1e308, -1e-9, 1e21, 123456789.123,
    NaN, Infinity, -Infinity, "", " ", "abc", "ABC", "5", " 12 ", "1e3", "0x10", "1,000", "TRUE", "false", "Infinity",
    "😀ab", "é", "a b  c", true, false, solError("#N/A", "x"), solError("#DIV/0!", "y"),
    "MCMXCIV", "XLII", "IIII", "CM", "MMXXVI", "1F", "ff", "FFFFFFFFFF", "7777777777", "1111111111", "101", "777", "1e2",
    "m", "ft", "C", "F", "K", "kg", "lb", "deg", "toString", 16, 8, 36, 2.75, 170, 171, -3, 1000, 1e6, 0.1, 13, "12"];
  const bits = (x: number) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(); };
  const norm = (r: unknown): unknown => {
    if (r === undefined) return { undef: true };
    if (r === null) return null;
    if (r instanceof Error) return { fx: (/#[A-Z0-9/?!.]+/.exec(r.message) ?? [""])[0] };
    if (isSolError(r)) return { err: r.code, msg: r.message };
    if (typeof r === "number") return { num: Number.isNaN(r) ? "NaN" : bits(r) };
    if (typeof r === "string") return { str: (r as string & { toWellFormed(): string }).toWellFormed() };
    if (typeof r === "boolean") return { bool: r };
    if (Array.isArray(r)) return { list: r.map(norm) };
    return { other: String(r) };
  };
  const LIST_BODIES = new Set(["WAVG", "WVAR", "WSTDEV", "COUNTDISTINCT", "ARGMAX", "ARGMIN", "LENGTH", "CONTAINS", "SUM", "MIN", "MAX", "AVERAGE", "MEDIAN", "PRODUCT", "STDEV", "STDEV.S", "STDEV.P", "VAR", "VAR.S", "VAR.P",
    "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC", "MODE", "MODE.SNGL",
    "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF", "XLOOKUP", "XMATCH",
    "AVEDEV", "GEOMEAN", "HARMEAN", "DEVSQ", "SKEW", "SKEW.P", "KURT", "PTP", "IQR", "MAD", "SEM", "CV", "RMS",
  "CORREL", "PEARSON", "RSQ", "KENDALL", "COVAR", "COVARIANCE.P", "COVARIANCE.S", "SLOPE", "INTERCEPT", "STEYX",
  "RANK", "RANK.EQ", "RANK.AVG", "TRIMMEAN", "PERCENTRANK", "PERCENTRANK.INC", "PERCENTRANK.EXC", "GCD", "LCM",
  "SUMSQ", "SUMPRODUCT", "MULTINOMIAL", "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "SERIESSUM", "Z.TEST", "CHISQ.TEST", "SPEARMAN",
  "FORECAST.LINEAR", "T.TEST", "F.TEST", "PROB"]);
  /** The IFS family reads its ranges raw and the lookups positionally: blanks and errors stay. */
  const RAW_LISTS = new Set(["WAVG", "WVAR", "WSTDEV", "COUNTDISTINCT", "ARGMAX", "ARGMIN", "LENGTH", "CONTAINS", "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF", "XLOOKUP", "XMATCH"]);
  it.each(PORTED)("%s", (name) => {
    const rand = mulberry32(77 + FUZZ_SEED + name.length * 1000 + name.charCodeAt(0));
    const fn = resolveExcelFunction(name)!;
    for (let i = 0; i < FUZZ_RUNS / 3; i++) {
      const one = () => POOL[Math.floor(rand() * POOL.length)];
      // A range argument as prepRangeArgs leaves it: no errors, no blanks, and no NaN (see SORTS_NUMBERS).
      const list = () => Array.from({ length: Math.floor(rand() * 7) }, one)
        .filter((v) => RAW_LISTS.has(name) ? v !== undefined : v != null && !isSolError(v) && !Number.isNaN(v));
      const args = Array.from({ length: Math.floor(rand() * 5) }, () => (LIST_BODIES.has(name) && rand() < 0.5 ? list() : one()));
      // SWITCH compares by identity, which a copy across the wire can't keep; an error never reaches it in a formula.
      if (name === "SWITCH" && args.some(isSolError)) continue;
      // A pad to a serial-sized width builds megabytes of text per call: true on both sides, and only slow.
      if (name === "PADTEXT" && Math.abs(Number(args[1])) > 1e4) continue;
      if (name === "BINOM.INV" && Math.abs(Number(args[0])) > 1e4) continue;
      // Text megabytes long, as above.
      if (/^(ROMAN|BASE|DEC2|HEX2|OCT2|BIN2)/.test(name) && args.some((a) => Math.abs(Number(a)) > 1e7 && Number.isFinite(Number(a)))) continue;
      let want: unknown;
      // A copy of each list, as `routeCall` hands a range function: Formula.js's `flatten` pushes into its first one.
      try { want = norm(fn(...args.map((a) => (Array.isArray(a) ? a.slice() : a)))); } catch (e) { want = { thrown: (e as Error).message }; }
      const wire = (a: unknown): unknown => (Array.isArray(a) ? a.map(wire) : a === undefined ? { __undef: 1 }
        : typeof a === "number" && !Number.isFinite(a) ? { __nf: Number.isNaN(a) ? "nan" : a > 0 ? "inf" : "-inf" }
        : Object.is(a, -0) ? { __nf: "-0" }
        : isSolError(a) ? { __err: a.code, msg: a.message } : a);
      const raw = wasmInvokeSync<{ num?: string }>("engine_call", { name, args: args.map(wire), clock: engineClock() });
      const nanBits = (b: string) => (BigInt(b) & 0x7ff0000000000000n) === 0x7ff0000000000000n && (BigInt(b) & 0xfffffffffffffn) !== 0n;
      if (raw && (raw as { bail?: boolean }).bail) continue;
      const nanFix = (x: unknown): unknown => {
        const o = x as { num?: string; list?: unknown[] } | null;
        if (o && o.num && nanBits(o.num)) return { num: "NaN" };
        return o && o.list ? { list: o.list.map(nanFix) } : x;
      };
      const got = nanFix(raw);
      if (JSON.stringify(got) !== JSON.stringify(want)) expect({ name, args, got }).toEqual({ name, args, got: want });
    }
  });
});

describe("the leftover one-value functions match bit for bit on realistic arguments", () => {
  const bits = (x: number) => (Number.isNaN(x) ? "NaN" : new DataView(Float64Array.of(x).buffer).getBigUint64(0, true).toString());
  const norm = (r: unknown): unknown => (r === undefined ? { undef: true } : r === null ? null
    : r instanceof Error ? { fx: (/#[A-Z0-9/?!.]+/.exec(r.message) ?? [""])[0] }
    : isSolError(r) ? { err: r.code, msg: r.message } : typeof r === "number" ? { num: bits(r) } : typeof r === "string" ? { str: r }
    : typeof r === "boolean" ? { bool: r } : { other: String(r) });
  const got = (raw: unknown): unknown => {
    const o = raw as { num?: string } | null;
    if (o && o.num !== undefined) return { num: bits(new DataView(new BigUint64Array([BigInt(o.num)]).buffer).getFloat64(0, true)) };
    return o;
  };
  const UNITS = ["rad", "deg", "grad", "m", "km", "cm", "mm", "in", "ft", "yd", "mi", "g", "kg", "mg", "lb", "oz_m", "stone", "tonne",
    "C", "F", "K", "s", "min", "hr", "day", "wk", "yr", "m2", "km2", "ha", "acre", "l", "ml", "cup", "gal", "m3", "m_s", "km_h", "mph",
    "knot", "J", "kJ", "cal", "kcal", "BTU", "Wh", "kWh", "Pa", "kPa", "bar", "atm", "psi", "mmHg", "nope", "toString", "M"];
  type Gen = (r: () => number) => unknown[];
  const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const list = (n: number, f: () => number) => Array.from({ length: n }, f);
  const reals = (r: () => number, n: number) => list(n, () => Math.round((r() * 200 - 100) * 64) / 64);
  const places = (r: () => number) => (r() < 0.5 ? [int(r, 0, 12)] : []);
  const CASES: Array<[string, Gen]> = [
    ["FACT", (r) => [r() < 0.8 ? int(r, 0, 200) : r() * 30]],
    ["FACTDOUBLE", (r) => [r() < 0.8 ? int(r, 0, 320) : r() * 30]],
    ["COMBIN", (r) => { const n = int(r, 0, 80); return [n, int(r, 0, n)]; }],
    ["COMBINA", (r) => { const n = int(r, 1, 40); return [n, int(r, 0, n)]; }],
    ["PERMUT", (r) => { const n = int(r, 0, 120); return [n, int(r, 0, n)]; }],
    ["PERMUTATIONA", (r) => [int(r, 0, 40), int(r, 0, 12)]],
    ["MULTINOMIAL", (r) => list(int(r, 1, 5), () => int(r, 0, 25))],
    ["SUMSQ", (r) => [reals(r, int(r, 1, 9)), r() * 10]],
    ["SUMPRODUCT", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n), ...(r() < 0.5 ? [reals(r, n)] : [])]; }],
    ["SUMX2MY2", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n)]; }],
    ["SUMX2PY2", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n)]; }],
    ["SUMXMY2", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n)]; }],
    ["SERIESSUM", (r) => [r() * 4 - 2, int(r, 0, 4), r() < 0.5 ? 1 : r() * 2, reals(r, int(r, 1, 6))]],
    ["BASE", (r) => [r() < 0.6 ? int(r, 0, 2 ** 40) : r() < 0.5 ? r() * 10 ** int(r, -8, 30) : -r() * 1000, int(r, 2, 36), int(r, 0, 12)]],
    ["DECIMAL", (r) => {
      const radix = int(r, 2, 36);
      const v = r() < 0.5 ? int(r, 0, 2 ** 31) : r() * 2 ** int(r, 40, 120);
      return [Math.floor(v).toString(radix) + (r() < 0.2 ? "zz!" : ""), radix];
    }],
    ["ROMAN", (r) => [int(r, 0, 3999) + (r() < 0.1 ? 0.5 : 0)]],
    ["ARABIC", (r) => [r() < 0.9 ? resolveExcelFunction("ROMAN")!(int(r, 1, 3999)) : ["MMXXVI", "IIII", "IM", "", "mcm", "CMCM"][int(r, 0, 5)]]],
    ["DEC2BIN", (r) => [int(r, -512, 511), ...places(r)]],
    ["DEC2OCT", (r) => [int(r, -536870912, 536870911), ...places(r)]],
    ["DEC2HEX", (r) => [int(r, -549755813888, 549755813887), ...places(r)]],
    ["BIN2DEC", (r) => [int(r, 0, 1023).toString(2).padStart(int(r, 1, 10), "0").slice(-10)]],
    ["BIN2HEX", (r) => [int(r, 0, 1023).toString(2), ...places(r)]],
    ["BIN2OCT", (r) => [int(r, 0, 1023).toString(2), ...places(r)]],
    ["HEX2DEC", (r) => [int(r, 0, 2 ** 40 - 1).toString(16)]],
    ["HEX2BIN", (r) => [(r() < 0.5 ? int(r, 0, 511) : 2 ** 40 - int(r, 1, 512)).toString(16), ...places(r)]],
    ["HEX2OCT", (r) => [(r() < 0.5 ? int(r, 0, 536870911) : 2 ** 40 - int(r, 1, 536870912)).toString(16), ...places(r)]],
    ["OCT2DEC", (r) => [int(r, 0, 2 ** 30 - 1).toString(8)]],
    ["OCT2BIN", (r) => [(r() < 0.5 ? int(r, 0, 511) : 2 ** 30 - int(r, 1, 512)).toString(8), ...places(r)]],
    ["OCT2HEX", (r) => [int(r, 0, 2 ** 30 - 1).toString(8), ...places(r)]],
    ["BITAND", (r) => [int(r, 0, 2 ** 48 - 1), int(r, 0, 2 ** 48 - 1)]],
    ["BITOR", (r) => [int(r, 0, 2 ** 40), int(r, 0, 2 ** 20)]],
    ["BITXOR", (r) => [int(r, 0, 2 ** 33), int(r, 0, 2 ** 33)]],
    ["BITLSHIFT", (r) => [int(r, 0, 2 ** 40), int(r, -53, 53) + (r() < 0.2 ? 0.5 : 0)]],
    ["BITRSHIFT", (r) => [int(r, 0, 2 ** 40), int(r, -53, 53)]],
    ["DELTA", (r) => [int(r, 0, 3), ...(r() < 0.5 ? [int(r, 0, 3)] : [])]],
    ["GESTEP", (r) => [r() * 10 - 5, ...(r() < 0.5 ? [r() * 10 - 5] : [])]],
    ["ERF", (r) => [r() * 8 - 4]],
    ["ERF.PRECISE", (r) => [r() * 12 - 6]],
    ["ERFC", (r) => [r() < 0.8 ? r() * 8 - 4 : String(Math.round(r() * 40) / 10)]],
    ["ERFC.PRECISE", (r) => [r() * 8 - 4]],
    ["GAMMA", (r) => [r() < 0.7 ? r() * 60 - 20 : -int(r, 0, 1e5) - 0.5]],
    ["GAMMALN", (r) => [r() * 200]],
    ["GAMMALN.PRECISE", (r) => [r() * 200 - 1]],
    ["Z.TEST", (r) => [reals(r, int(r, 1, 9)), r() * 20 - 10, ...(r() < 0.4 ? [r() * 5] : [])]],
    ["CHISQ.TEST", (r) => { const n = int(r, 1, 8); return [list(n, () => int(r, 1, 60)), list(n, () => int(r, 1, 60))]; }],
    ["SPEARMAN", (r) => { const n = int(r, 0, 9); return [list(n, () => int(r, 0, 6)), reals(r, n)]; }],
    ["FORECAST.LINEAR", (r) => { const n = int(r, 0, 9); return [r() * 20, reals(r, n), list(n, () => int(r, 0, 5))]; }],
    ["T.TEST", (r) => [reals(r, int(r, 1, 9)), reals(r, int(r, 1, 9)), int(r, 1, 2), int(r, 1, 3)]],
    ["F.TEST", (r) => [reals(r, int(r, 1, 9)), reals(r, int(r, 1, 9))]],
    ["PROB", (r) => { const n = int(r, 0, 8); return [list(n, () => int(r, 0, 9)), list(n, () => r() / 4), int(r, 0, 9), ...(r() < 0.5 ? [int(r, 0, 9)] : [])]; }],
    ["FISHERINV", (r) => [r() * 8 - 4]],
    ["LOG2", (r) => [r() < 0.5 ? 2 ** int(r, -60, 60) : 10 ** (r() * 40 - 20)]],
    ["CONVERT", (r) => [r() * 2000 - 1000, UNITS[int(r, 0, UNITS.length - 1)], UNITS[int(r, 0, UNITS.length - 1)]]],
    ["GAUSS", (r) => [r() * 8 - 4]],
    ["FISHEREXACT", (r) => [int(r, 0, 30), int(r, 0, 30), int(r, 0, 30), int(r, 0, 30)]],
    ["PROPTEST", (r) => { const n1 = int(r, 1, 200), n2 = int(r, 1, 200); return [int(r, 0, n1), n1, int(r, 0, n2), n2]; }],
    ["BINOMTEST", (r) => { const n = int(r, 1, 300); return [int(r, 0, n), n, r() < 0.1 ? int(r, 0, 1) : r()]; }],
    ["PHI", (r) => [r() * 8 - 4]],
    ["CONFIDENCE.NORM", (r) => [r() * 0.5, r() * 10, int(r, 1, 100)]],
    ["BINOM.DIST.RANGE", (r) => { const n = int(r, 1, 60); const s = int(r, 0, n); return [n, r(), s, ...(r() < 0.5 ? [int(r, s, n)] : [])]; }],
    ["CLEAN", (r) => [["a\u0001b", "x\ty\n", "\u001fend", "plain", ""][int(r, 0, 4)]]],
    ["DB", (r) => { const life = int(r, 1, 30); return [r() * 10000, r() * 2000, life, int(r, 1, life), ...(r() < 0.5 ? [int(r, 1, 12)] : [])]; }],
    ["DDB", (r) => { const life = int(r, 1, 30); return [r() * 10000, r() * 2000, life, int(r, 1, life), ...(r() < 0.5 ? [r() * 3] : [])]; }],
    ["SYD", (r) => { const life = int(r, 1, 30); return [r() * 10000, r() * 2000, life, r() * life + 1]; }],
    ["EFFECT", (r) => [r() * 0.3, r() * 24 + 1]],
    ["NOMINAL", (r) => [r() * 0.3, r() * 24 + 1]],
    ["PDURATION", (r) => [r() * 0.3, r() * 1000, r() * 5000]],
    ["RRI", (r) => [int(r, 1, 40), r() * 1000, r() * 5000]],
    ["ISPMT", (r) => [r() * 0.2, int(r, 1, 12), int(r, 1, 12), r() * 1e5]],
    ["DOLLARDE", (r) => [r() * 200 - 100, int(r, 1, 64) + (r() < 0.2 ? 0.5 : 0)]],
    ["DOLLARFR", (r) => [r() * 200 - 100, int(r, 1, 64)]],
    ["EDATE", (r) => [r() < 0.1 ? int(r, 0, 70) : int(r, 0, 2958465), r() < 0.8 ? int(r, -2400, 2400) : [String(int(r, -40, 40)), 2.9, -0.5, " 3x", 1e21][int(r, 0, 4)]]],
  ];
  it.each(CASES)("%s", (name, gen) => {
    const rand = mulberry32(8080 + FUZZ_SEED + name.length * 31 + name.charCodeAt(0));
    const fn = resolveExcelFunction(name)!;
    let ran = 0;
    for (let i = 0; i < FUZZ_RUNS / 10; i++) {
      const args = gen(rand);
      let want: unknown;
      try { want = norm(fn(...args.map((a) => (Array.isArray(a) ? a.slice() : a)))); } catch (e) { want = { thrown: (e as Error).message }; }
      const raw = wasmInvokeSync("engine_call", { name, args, clock: engineClock() });
      if ((raw as { bail?: boolean } | null)?.bail) continue;
      ran++;
      const g = got(raw);
      if (JSON.stringify(g) !== JSON.stringify(want)) expect({ name, args, got: g }).toEqual({ name, args, got: want });
    }
    // EDATE stays on the TS in a zone whose local midnight can round to another day (Pacific/Auckland's +13).
    if (name !== "EDATE" || engineClock().midnightRounds) expect(ran, "most calls should run on the engine").toBeGreaterThan(FUZZ_RUNS / 20);
  });
});
