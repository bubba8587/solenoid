// [[C16]] polarsEngine
// The Rust engine (crates/solenoid-core) in WebAssembly against the JS oracle, through the real backend wrapper:
// the parity corpus, then seeded random frames under random verbs. The oracle is the spec, so every difference,
// a cell, an error's code or message, or a thrown error, is a Rust bug.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyVerb, joinFrames, appendFrames, bindColumns, pivotFrame, type FrameOp, type JoinOpts, type PivotSpec, type AggOp } from "../../src/graph/frameVerbs";
import { pivotLayoutOf } from "../../src/graph/pivotLayout";
import type { ColumnUnit } from "../../src/graph/unitValue";
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "../../src/graph/frame";
import { isSolError, solError, type SolErrorCode } from "../../src/graph/errorValue";
import { frameBackend, useWasmBackend, resetFrameBackendToJs, pivotOnEngine, computeColumnOnEngine } from "../../src/graph/frameBackend";
import { parseFormula, compileEvaluator, extractVariables, rowRefNames } from "../../src/graph/excelFormula";
import { computeColumnCells } from "../../src/graph/computedColumnCore";
import { loadWasmEngineSync, wasmInvokeSync } from "../../src/graph/engineWasm";

const WASM = path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm");
const CORPUS_DIR = path.resolve(__dirname, "../../fixtures/frame-verbs");

beforeAll(() => {
  loadWasmEngineSync(fs.readFileSync(WASM));
  useWasmBackend();
});
afterAll(() => resetFrameBackendToJs());

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
  "UPPER", "LOWER", "TRIM", "REPT", "SUBSTITUTE", "YEAR", "MONTH", "DAY", "TEXT", "VLOOKUP", "XLOOKUP", "SEQUENCE"];
const OPS = ["+", "-", "*", "/", "^", "&", "=", "<>", "<", ">", "<=", ">="];

function formulaGen(rand: () => number) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const lit = () => pick(["0", "1", "2", "-0", "3.5", "1e3", ".5", "10", "100", "1e308", "0.1", "7"]);
  const str = () => `"${pick(["", "abc", "ABC", "TRUE", "false", "5", " a  b ", "😀x", "é", "1,000", "x", "#N/A"])}"`;
  const ref = () => pick(["@a", "@b", "@c", "@d", "[@a]", "@[b]", "[@[c]]", "@nope", "a", "pi", "E", "Tau", "s1", "@s2", "[@s1]", "s3", "@name"]);
  const expr = (depth: number): string => {
    const r = rand();
    if (depth <= 0 || r < 0.3) return pick([lit, str, ref, ref, () => pick(["TRUE", "FALSE", "true"])])();
    if (r < 0.4) return `${pick(["-", "+"])}${expr(depth - 1)}`;
    if (r < 0.45) return `${expr(depth - 1)}%`;
    if (r < 0.65) return `${expr(depth - 1)} ${pick(OPS)} ${expr(depth - 1)}`;
    if (r < 0.7) return `(${expr(depth - 1)})`;
    const name = pick(FNS);
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
  const well = (v: unknown) => (typeof v === "string" ? (v as string & { toWellFormed(): string }).toWellFormed() : v);
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
        if (type === "string") return ["", "abc", "Abc", " x ", "12", "TRUE", "😀", "é", "true"][Math.floor(rand() * 9)];
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

  it.each(["exp", "log", "log10", "pow"])("%s", (fn) => {
    const rand = mulberry32(31337 + FUZZ_SEED);
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < FUZZ_RUNS * 10; i++) {
      const nice = rand() < 0.5;
      const x = fn === "exp" ? (nice ? Math.round(rand() * 1400 - 700) / 4 : rand() * 1400 - 700)
        : fn === "pow" ? (nice ? Math.round(rand() * 400) / 10 : rand() * 50)
        : (nice ? Math.round(rand() * 1e4) / 8 : Math.exp(rand() * 300 - 150));
      xs.push(x);
      ys.push(nice ? Math.round(rand() * 60 - 30) / 2 : rand() * 60 - 30);
    }
    const math = { exp: Math.exp, log: Math.log, log10: Math.log10, pow: Math.pow }[fn as "exp"] as (a: number, b?: number) => number;
    const bits = (x: number) => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, x); return v.getBigUint64(0).toString(); };
    const got = wasmInvokeSync<string[]>("engine_math", { fn, xs, ys });
    const bad = xs.map((x, i) => [x, ys[i], math(x, ys[i]), got[i]] as const)
      .filter(([, , want, g]) => !(Number.isNaN(want) ? (BigInt(g) & 0x7ff0000000000000n) === 0x7ff0000000000000n : bits(want) === g));
    expect(bad.slice(0, 3)).toEqual([]);
  });
});
