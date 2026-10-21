// [[C16]] polarsEngine
// The Rust engine (crates/solenoid-core) in WebAssembly against the JS oracle, through the real backend wrapper:
// the parity corpus, then seeded random frames under random verbs. The oracle is the spec, so every difference,
// a cell, an error's code or message, or a thrown error, is a Rust bug.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyVerb, joinFrames, appendFrames, bindColumns, type FrameOp, type JoinOpts } from "../../src/graph/frameVerbs";
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "../../src/graph/frame";
import { isSolError, solError, type SolErrorCode } from "../../src/graph/errorValue";
import { frameBackend, useWasmBackend, resetFrameBackendToJs } from "../../src/graph/frameBackend";
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
const TEXT = ["x", "X", "apple", "Apple", "", "  ", "10", "1,000", "2.5", "true", "FALSE", "é", "É", "", "😀", "a b", "zz"];
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
