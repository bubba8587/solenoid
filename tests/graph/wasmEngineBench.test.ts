// [[C16]] polarsEngine
// Timing, not a check: the JS oracle against the Rust engine in WebAssembly over one large frame.
// `BENCH=1 npx vitest run tests/graph/wasmEngineBench.test.ts` prints the table; a plain run skips it.
import { describe, it, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyVerb, joinFrames, type FrameOp } from "../../src/graph/frameVerbs";
import type { FrameValue } from "../../src/graph/frame";
import { frameBackend, useWasmBackend, resetFrameBackendToJs, type FrameHandle } from "../../src/graph/frameBackend";
import { loadWasmEngineSync, wasmInvokeSync } from "../../src/graph/engineWasm";
import { computeColumnOnEngine } from "../../src/graph/frameBackend";
import { compileEvaluator, extractVariables } from "../../src/graph/excelFormula";
import { computeColumnCells } from "../../src/graph/computedColumnCore";

const ROWS = Number(process.env.BENCH_ROWS ?? 200_000);

function bigFrame(rows: number): FrameValue {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const col = <T,>(f: (i: number) => T) => Array.from({ length: rows }, (_, i) => f(i));
  return {
    __frame: true,
    columns: [
      { name: "key", type: "string", values: col(() => `k${Math.floor(rand() * 1000)}`) },
      { name: "cat", type: "number", values: col(() => Math.floor(rand() * 50)) },
      { name: "value", type: "number", values: col(() => (rand() < 0.02 ? null : Math.round(rand() * 1e6) / 100 - 5000)) },
      { name: "day", type: "date", values: col((i) => 45000 + (i % 3650)) },
      { name: "flag", type: "logical", values: col(() => rand() < 0.5) },
    ],
  };
}

const lookup: FrameValue = {
  __frame: true,
  columns: [
    { name: "key", type: "string", values: Array.from({ length: 1000 }, (_, i) => `k${i}`) },
    { name: "region", type: "string", values: Array.from({ length: 1000 }, (_, i) => `r${i % 7}`) },
  ],
};

const CASES: [string, FrameOp[]][] = [
  ["sort by a number", [{ kind: "sort", by: "value", dir: "desc" }]],
  ["sort by text", [{ kind: "sort", by: "key", dir: "asc" }]],
  ["filter value > 0", [{ kind: "filter", column: "value", op: "gt", value: 0 }]],
  ["filter text contains", [{ kind: "filter", column: "key", op: "contains", value: "K1", matchCase: false }]],
  ["distinct key", [{ kind: "distinct", columns: ["key"] }]],
  ["group by key: sum, avg, median", [{ kind: "groupBy", keys: ["key"], aggs: [
    { column: "value", op: "sum", as: "s" }, { column: "value", op: "avg", as: "a" }, { column: "value", op: "median", as: "m" }] }]],
  ["window: cumsum by cat over day", [{ kind: "window", partitionBy: ["cat"], orderBy: "day", fn: "cumsum", column: "value", as: "run" }]],
  ["window: rank by cat", [{ kind: "window", partitionBy: ["cat"], orderBy: "value", orderDir: "desc", fn: "rank", as: "rk" }]],
  ["pipeline: filter, group, sort", [
    { kind: "filter", column: "flag", op: "eq", value: true },
    { kind: "groupBy", keys: ["cat", "key"], aggs: [{ column: "value", op: "sum", as: "s" }] },
    { kind: "sort", by: "s", dir: "desc" }]],
];

function time(run: () => unknown, reps = 3): number {
  run();
  let best = Infinity;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

async function timeAsync(run: () => Promise<unknown>, reps = 3): Promise<number> {
  await run();
  let best = Infinity;
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    await run();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe.skipIf(!process.env.BENCH)("frame engine timing", () => {
  beforeAll(() => {
    loadWasmEngineSync(fs.readFileSync(path.resolve(__dirname, "../../src/graph/engineWasm/solenoid_core_bg.wasm")));
    useWasmBackend();
  });
  afterAll(() => resetFrameBackendToJs());

  it(`${ROWS} rows`, { timeout: 600_000 }, async () => {
    const f = bigFrame(ROWS);
    const be = frameBackend();
    const rows: string[][] = [];
    const sourceMs = await timeAsync(async () => be.drop(await be.source(f)));
    const h = await be.source(f);
    const r = await be.source(lookup);
    const collectMs = await timeAsync(() => be.collect(h));
    for (const [name, ops] of CASES) {
      const js = time(() => ops.reduce((acc, op) => applyVerb(acc, op), f));
      const rs = await timeAsync(async () => { const out = await be.applyMany(h, ops); await be.preview(out, 100); be.drop(out); });
      rows.push([name, js.toFixed(1), rs.toFixed(1), (js / rs).toFixed(1)]);
    }
    {
      const opts = { leftKey: "key", rightKey: "key", how: "left" as const };
      const js = time(() => joinFrames(f, lookup, opts));
      const rs = await timeAsync(async () => { const out = await be.join(h, r, opts); await be.preview(out, 100); be.drop(out); });
      rows.push(["left join a 1000-row lookup", js.toFixed(1), rs.toFixed(1), (js / rs).toFixed(1)]);
    }
    for (const expr of ["@value * 1.2 + @cat", "IF(@value > 0, ROUND(@value * 1.2, 2), 0)", "@key & \"-\" & UPPER(@key)", "IFERROR(LN(@value), 0) + MAX(@cat, 10)"]) {
      const evaluator = compileEvaluator(expr)!;
      const js = time(() => computeColumnCells(f, { kind: "expr", evaluator, vars: extractVariables(expr) }, {}));
      const rs = time(() => computeColumnOnEngine(f, expr, ROWS));
      rows.push([`fx: ${expr}`, js.toFixed(1), rs.toFixed(1), (js / rs).toFixed(1)]);
    }
    const width = Math.max(...rows.map((x) => x[0].length));
    const lines = [
      `${ROWS} rows × 5 columns; best of 3; Rust = the op plus a 100-row preview, the frame already in wasm; an fx row uploads its columns and downloads the answer`,
      `upload into wasm ${sourceMs.toFixed(1)} ms, full download ${collectMs.toFixed(1)} ms`,
      `${"op".padEnd(width)}  ${"JS ms".padStart(8)}  ${"Rust ms".padStart(8)}  ${"×".padStart(6)}`,
      ...rows.map(([n, a, b, c]) => `${n.padEnd(width)}  ${a.padStart(8)}  ${b.padStart(8)}  ${c.padStart(6)}`),
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
    wasmInvokeSync("engine_clear");
    void (h as FrameHandle);
  });
});
