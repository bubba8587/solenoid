// Fuzzes the frame-verb parity corpus: random frames and ops, expected results from the JS oracle,
// written as ordinary fixtures (fixtures/frame-verbs/fuzz-*.json) that the cargo corpus runner then checks.
//   npx tsx scripts/fuzz-frame-verbs.ts [seed] [casesPerVerb]
//   cd src-tauri && cargo test corpus_cases       # the divergence hunt
//   rm fixtures/frame-verbs/fuzz-*.json           # cleanup; keep any find as a hand-named case
// Pipeline cases (2-5 chained ops, which cargo fuses into one Polars plan) skip when any step holds
// error cells; single-verb error cells are kept, encoded as {"__err": code}.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { applyVerb, joinFrames, appendFrames, type FrameOp, type JoinOpts, type FilterOp, type AggOp } from "../src/graph/frameVerbs";
import { isSolError } from "../src/graph/errorValue";
import type { FrameValue, FrameCell, FrameColType } from "../src/graph/frame";

const SEED = Number(process.argv[2] ?? 20260729);
const PER_VERB = Number(process.argv[3] ?? 40);
const OUT = path.resolve(__dirname, "../fixtures/frame-verbs");

let s = SEED >>> 0;
function rnd(): number {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p: number) => rnd() < p;

const NUMBERS: FrameCell[] = [
  0, 1, -1, 2, 2.5, -3, 0.1, 10, 1234, 1e10, 1e308, -0, null, NaN, Infinity, -Infinity,
  -2.5, 0.30000000000000004, 1e-15, -1e-300, 9007199254740993, 46096.25, 0.5, 100,
];
const STRINGS: FrameCell[] = [
  "", "a", "A", "b", "Oslo", "oslo", "OSLO", " x ", "1", "1,234", "x\u0001s:y", "Jos\u00e9",
  "true", null, "null", "NaN", "-0", "  ", "a b", "\u00df", "\u0130", "0", "false", "Stra\u00dfe",
];
const LOGICALS: FrameCell[] = [true, false, null];
const DATES: FrameCell[] = [46000, 46010, 46096, 46096.25, 0, -30000, null];
const CELLS: Record<FrameColType, FrameCell[]> = { number: NUMBERS, string: STRINGS, logical: LOGICALS, date: DATES };
const NAME_POOL = ["a", "b", "c", "k", "v", "qty", "city", "when", "flag"];

function randFrame(opts?: { minCols?: number; types?: FrameColType[]; rows?: number }): FrameValue {
  const nCols = Math.max(opts?.minCols ?? 1, int(1, 4));
  const rows = opts?.rows ?? int(0, 14);
  const names = [...NAME_POOL].sort(() => rnd() - 0.5).slice(0, nCols);
  const types = opts?.types ?? (["number", "string", "logical", "date"] as FrameColType[]);
  return {
    __frame: true,
    columns: names.map((name) => {
      const type = pick(types);
      return { name, type, values: Array.from({ length: rows }, () => pick(CELLS[type])) };
    }),
  };
}
const colNames = (f: FrameValue) => f.columns.map((c) => c.name);
const someCol = (f: FrameValue) => (f.columns.length === 0 || chance(0.08) ? "missing" : pick(colNames(f)));
const numericCol = (f: FrameValue) => f.columns.find((c) => c.type === "number" || c.type === "date");

function enc(v: FrameCell): unknown {
  if (typeof v === "number") {
    if (Number.isNaN(v)) return { __nf: "nan" };
    if (v === Infinity) return { __nf: "inf" };
    if (v === -Infinity) return { __nf: "-inf" };
  }
  if (isSolError(v)) return { __err: v.code };
  return v;
}
const encFrame = (f: FrameValue) => ({ columns: f.columns.map((c) => ({ name: c.name, type: c.type, values: c.values.map(enc) })) });

const FILTER_OPS: FilterOp[] = ["eq", "neq", "lt", "lte", "gt", "gte", "contains", "startsWith", "endsWith", "isblank", "notblank"];
const FILTER_VALUES: FrameCell[] = [0, 1, 12, "oslo", "OS", "a", "garbage", " 1100 ", "1,234", "false", "TRUE", true, null];
const AGG_OPS: AggOp[] = ["sum", "avg", "min", "max", "count", "product", "median", "mode", "stdev", "stdevp", "var", "varp"];

type Gen = () => { frames: Record<string, FrameValue>; op: Record<string, unknown> };
const cond = (f: FrameValue) => ({ column: someCol(f), op: pick(FILTER_OPS), value: pick(FILTER_VALUES), ...(chance(0.3) ? { matchCase: true } : {}) });

// Every maker must tolerate any frame shape: a chain can drop to one column or zero rows mid-way.
type OpMaker = (f: FrameValue) => Record<string, unknown>;
const UNARY_MAKERS: Record<string, OpMaker> = {
  select: (f) => ({ kind: "select", columns: Array.from({ length: int(1, 3) }, () => someCol(f)) }),
  drop:   (f) => ({ kind: "drop", columns: Array.from({ length: int(1, 2) }, () => someCol(f)) }),
  rename: (f) => {
    const map: Record<string, string> = {};
    for (let i = 0; i < int(1, 2); i++) map[someCol(f)] = pick([...NAME_POOL, someCol(f)]);
    return { kind: "rename", map };
  },
  sort:     (f) => ({ kind: "sort", by: someCol(f), dir: pick(["asc", "desc"]) }),
  distinct: (f) => ({ kind: "distinct", ...(chance(0.5) ? { columns: [someCol(f)] } : {}) }),
  head:     () => ({ kind: "head", n: pick([0, 1, 2, 5, 99, -3]) }),
  filter:   (f) => ({ kind: "filter", ...cond(f) }),
  filterMulti: (f) => ({
    kind: "filterMulti", combine: pick(["and", "or"]),
    conditions: Array.from({ length: int(0, 3) }, () => cond(f)),
    ...(chance(0.3) ? { complement: true } : {}),
  }),
  groupBy: (f) => {
    const keys = [...new Set(Array.from({ length: int(1, 2) }, () => someCol(f)))];
    return { kind: "groupBy", keys, aggs: Array.from({ length: int(1, 3) }, () => ({ column: someCol(f), op: pick(AGG_OPS), as: pick(NAME_POOL) })) };
  },
  unpivot: (f) => {
    const names = colNames(f);
    if (names.length < 2) return { kind: "unpivot", idColumns: [], valueColumns: names.length ? names : ["missing"] };
    const split = int(1, names.length - 1);
    return {
      kind: "unpivot", idColumns: names.slice(0, split), valueColumns: chance(0.08) ? ["missing"] : names.slice(split),
      ...(chance(0.3) ? { variableName: "var", valueName: "val" } : {}),
    };
  },
};
const WANT_TWO_COLS = new Set(["groupBy", "unpivot"]);

const GENERATORS: Record<string, Gen> = Object.fromEntries(
  Object.entries(UNARY_MAKERS).map(([verb, mk]) => [verb, () => {
    const f = randFrame(WANT_TWO_COLS.has(verb) ? { minCols: 2 } : undefined);
    return { frames: { in: f }, op: mk(f) };
  }]),
);

GENERATORS.pipeline = () => {
  const f0 = randFrame({ minCols: 2 });
  let cur = f0;
  const ops: Record<string, unknown>[] = [];
  const len = int(2, 5);
  for (let i = 0; i < len; i++) {
    const op = UNARY_MAKERS[pick(Object.keys(UNARY_MAKERS))](cur);
    ops.push(op);
    try { cur = applyVerb(cur, op as unknown as FrameOp); } catch { break; }
  }
  return { frames: { in: f0 }, op: { kind: "pipeline", ops } };
};
GENERATORS.join = () => {
  const how = pick(["inner", "left", "right", "outer", "semi", "anti", "asof"] as const);
  if (how === "asof") {
    const left = randFrame({ types: ["number"], rows: int(0, 6) });
    const right = randFrame({ types: ["number"], rows: int(0, 6) });
    return { frames: { left, right }, op: {
      kind: "join", leftKey: someCol(left), rightKey: someCol(right), how,
      ...(chance(0.7) ? { asofDirection: pick(["backward", "forward", "nearest"]) } : {}),
      ...(chance(0.4) ? { asofTolerance: pick([1, 2, 10]) } : {}),
    } };
  }
  const left = randFrame(); const right = randFrame();
  return { frames: { left, right }, op: { kind: "join", leftKey: someCol(left), rightKey: someCol(right), how } };
};
GENERATORS.append = () => {
  const n = int(2, 3);
  const frames: Record<string, FrameValue> = {};
  const order: string[] = [];
  for (let i = 0; i < n; i++) { const k = `f${i + 1}`; frames[k] = randFrame(); order.push(k); }
  return { frames, op: { kind: "append", frames: order } };
};

const hasErrorCell = (f: FrameValue) => f.columns.some((c) => c.values.some((v) => isSolError(v)));
const SKIP = Symbol("skip: error cells mid-chain");
let written = 0, errCases = 0, skippedErrCells = 0;
const crashes: string[] = [];

for (const [verb, gen] of Object.entries(GENERATORS)) {
  const cases: unknown[] = [];
  for (let i = 0; cases.length < PER_VERB && i < PER_VERB * 3; i++) {
    const { frames, op } = gen();
    let out: FrameValue | undefined; let err: unknown;
    try {
      if (verb === "join") { const { kind: _k, ...opts } = op; out = joinFrames(frames.left, frames.right, opts as unknown as JoinOpts); }
      else if (verb === "append") out = appendFrames((op.frames as string[]).map((k) => frames[k]));
      else if (verb === "pipeline") {
        let cur = frames.in;
        for (const o of op.ops as FrameOp[]) {
          cur = applyVerb(cur, o);
          if (hasErrorCell(cur)) throw SKIP;
        }
        out = cur;
      }
      else out = applyVerb(frames.in, op as unknown as FrameOp);
    } catch (e) {
      if (e === SKIP) { skippedErrCells++; continue; }
      err = e;
    }
    const name = `fuzz seed=${SEED} ${verb} #${i}`;
    const base = { name, frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, encFrame(f)])), op };
    if (err !== undefined) {
      if (!isSolError(err)) { crashes.push(`${name}: ${(err as Error)?.message ?? err}`); continue; }
      cases.push({ ...base, expectError: err.code }); errCases++;
    } else {
      cases.push({ ...base, expect: encFrame(out!) });
    }
  }
  fs.writeFileSync(path.join(OUT, `fuzz-${verb}.json`), JSON.stringify({ verb, cases }, null, 1) + "\n");
  written += cases.length;
}

console.log(`wrote ${written} cases (${errCases} expectError) across ${Object.keys(GENERATORS).length} fuzz-*.json files`);
console.log(`skipped ${skippedErrCells} pipeline cases with SolError cells mid-chain (oracle-only semantics)`);
if (crashes.length) {
  console.log(`\nORACLE CRASHES (non-SolError throws — real bugs, investigate):\n  ${crashes.join("\n  ")}`);
  process.exitCode = 1;
}
