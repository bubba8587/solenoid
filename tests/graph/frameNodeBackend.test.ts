// The node-facing verb runners (runFrameUnary/Join/Append) + collect, on the JS
// backend (the web path + the Polars oracle). Each runner must produce EXACTLY what
// the pure verb produces — that's what guarantees the migrated frame nodes behave
// identically to the old direct-verb path. A structural failure comes back as a
// tagged SolError VALUE, never a throw.
import { describe, it, expect, beforeEach } from "vitest";
import { runFrameUnary, runFrameJoin, runFrameAppend, readFrame, frameBackend, resetFrameBackendToJs, SKETCH_SAMPLE_ROWS } from "../../src/graph/frameBackend";
import { calcModeStore } from "../../src/graph/calcModeStore";
import { ReplaceValuesNode } from "../../src/graph/nodes/frame";
import {
  selectColumns, dropColumns, renameColumns, sortByColumn, distinctRows, headRows,
  filterRows, groupByFrame, pivotFrame, unpivotFrame, joinFrames, appendFrames,
  type FrameOp, type JoinOpts,
} from "../../src/graph/frameVerbs";

// The runners now return a LAZY ref (the result stays in the backend); collect it
// back to compare against the pure verb. (An op that fails returns a SolError VALUE
// directly — not a ref — so the error case below reads runFrameUnary without collect.)
const u = async (op: FrameOp) => readFrame(await runFrameUnary(sample, op));
import { isSolError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";

const sample: FrameValue = {
  __frame: true,
  columns: [
    { name: "region", type: "string", values: ["N", "S", "N", "S"] },
    { name: "qty", type: "number", values: [10, 20, 30, 40] },
    { name: "flag", type: "logical", values: [true, false, true, false] },
  ],
};

describe("collect — full frame round-trip through a handle", () => {
  it("returns every row, not a head-N preview", async () => {
    resetFrameBackendToJs();
    const be = frameBackend();
    const h = await be.source(sample);
    const got = await be.collect(h);
    expect(got.__frame).toBe(true);
    expect(got.columns).toEqual(sample.columns);
  });
});

describe("runFrameUnary — parity with each pure verb", () => {
  it("select", async () => {
    expect(await u({ kind: "select", columns: ["qty", "region"] }))
      .toEqual(selectColumns(sample, ["qty", "region"]));
  });
  it("drop", async () => {
    expect(await u({ kind: "drop", columns: ["flag"] }))
      .toEqual(dropColumns(sample, ["flag"]));
  });
  it("rename", async () => {
    expect(await u({ kind: "rename", map: { qty: "Quantity" } }))
      .toEqual(renameColumns(sample, { qty: "Quantity" }));
  });
  it("sort", async () => {
    expect(await u({ kind: "sort", by: "qty", dir: "desc" }))
      .toEqual(sortByColumn(sample, "qty", "desc"));
  });
  it("distinct", async () => {
    expect(await u({ kind: "distinct" })).toEqual(distinctRows(sample));
  });
  it("head", async () => {
    expect(await u({ kind: "head", n: 2 })).toEqual(headRows(sample, 2));
  });
  it("filter", async () => {
    expect(await u({ kind: "filter", column: "qty", op: "gt", value: 15 }))
      .toEqual(filterRows(sample, "qty", "gt", 15));
  });
  it("groupBy", async () => {
    const aggs = [{ column: "qty", op: "sum" as const, as: "qty" }];
    expect(await u({ kind: "groupBy", keys: ["region"], aggs }))
      .toEqual(groupByFrame(sample, ["region"], aggs));
  });
  it("pivot", async () => {
    const spec = { rowFields: ["region"], colFields: ["flag"], values: ["qty"], funcs: ["sum" as const] };
    expect(await u({ kind: "pivot", ...spec }))
      .toEqual(pivotFrame(sample, spec));
  });
  it("unpivot", async () => {
    expect(await u({ kind: "unpivot", idColumns: ["region"], valueColumns: ["qty"] }))
      .toEqual(unpivotFrame(sample, ["region"], ["qty"]));
  });
  it("a #REF! (bad column) comes back as a SolError VALUE, not a throw", async () => {
    const out = await u({ kind: "select", columns: ["nope"] });
    expect(isSolError(out) && out.code).toBe("#REF!");
  });
});

describe("runFrameJoin / runFrameAppend — parity", () => {
  const left: FrameValue = { __frame: true, columns: [{ name: "id", type: "number", values: [1, 2] }] };
  const right: FrameValue = {
    __frame: true,
    columns: [
      { name: "id", type: "number", values: [1, 1] },
      { name: "v", type: "string", values: ["x", "y"] },
    ],
  };

  it("join (inner)", async () => {
    const opts: JoinOpts = { leftKey: "id", rightKey: "id", how: "inner" as const };
    expect(await readFrame(await runFrameJoin(left, right, opts))).toEqual(joinFrames(left, right, opts));
  });

  it("append (union by name)", async () => {
    const a: FrameValue = { __frame: true, columns: [{ name: "x", type: "number", values: [1] }, { name: "y", type: "number", values: [2] }] };
    const b: FrameValue = { __frame: true, columns: [{ name: "y", type: "number", values: [3] }] };
    expect(await readFrame(await runFrameAppend([a, b]))).toEqual(appendFrames([a, b]));
  });

  it("append type clash → #TYPE! VALUE", async () => {
    const a: FrameValue = { __frame: true, columns: [{ name: "x", type: "number", values: [1] }] };
    const b: FrameValue = { __frame: true, columns: [{ name: "x", type: "string", values: ["a"] }] };
    const out = await runFrameAppend([a, b]);
    expect(isSolError(out) && out.code).toBe("#TYPE!");
  });
});

describe("sketch mode (#24) — sampled verb execution + extrapolated aggregates", () => {
  const big: FrameValue = {
    __frame: true,
    columns: [
      { name: "region", type: "string", values: Array.from({ length: SKETCH_SAMPLE_ROWS * 2 }, (_, i) => (i % 2 === 0 ? "N" : "S")) },
      { name: "qty", type: "number", values: Array.from({ length: SKETCH_SAMPLE_ROWS * 2 }, () => 1) },
    ],
  };

  beforeEach(() => {
    resetFrameBackendToJs();
    calcModeStore.setMode("auto"); // also clears dirty; leaves sketch off
  });

  it("auto mode (sketch off) computes the exact sum over every row", async () => {
    const aggs = [{ column: "qty", op: "sum" as const, as: "total" }];
    const out = await readFrame(await runFrameUnary(big, { kind: "groupBy", keys: ["region"], aggs }));
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.__approx).toBeUndefined();
    const total = out.columns.find((c) => c.name === "total")!.values.reduce((a, b) => (a as number) + (b as number), 0);
    expect(total).toBe(SKETCH_SAMPLE_ROWS * 2); // one per row, exact
  });

  it("sketch mode caps to a sample and scales sum/count back toward the true total, marked __approx", async () => {
    calcModeStore.setMode("sketch");
    const aggs = [
      { column: "qty", op: "sum" as const, as: "total" },
      { column: "qty", op: "count" as const, as: "n" },
      { column: "qty", op: "avg" as const, as: "avg" },
    ];
    const out = await readFrame(await runFrameUnary(big, { kind: "groupBy", keys: ["region"], aggs }));
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.__approx).toBeDefined();
    expect(out.__approx!.factor).toBeCloseTo(2, 5); // 2×SKETCH_SAMPLE_ROWS rows sampled to SKETCH_SAMPLE_ROWS
    // sum/count are EXTRAPOLATED (scaled by the factor) — never the sample's raw total
    const total = out.columns.find((c) => c.name === "total")!.values.reduce((a, b) => (a as number) + (b as number), 0);
    expect(total).toBeCloseTo(SKETCH_SAMPLE_ROWS * 2, 5);
    // avg is NOT scaled — extrapolating an average would be wrong, not approximate
    for (const v of out.columns.find((c) => c.name === "avg")!.values) expect(v).toBe(1);
    calcModeStore.setMode("auto");
  });

  it("F9 (beginForceExact/endForceExact) forces an exact pass even while sketch mode is selected", async () => {
    calcModeStore.setMode("sketch");
    calcModeStore.beginForceExact();
    try {
      const aggs = [{ column: "qty", op: "sum" as const, as: "total" }];
      const out = await readFrame(await runFrameUnary(big, { kind: "groupBy", keys: ["region"], aggs }));
      if (isSolError(out) || out == null) throw new Error("expected a frame");
      expect(out.__approx).toBeUndefined(); // exact — no sampling happened this pass
    } finally {
      calcModeStore.endForceExact();
      calcModeStore.setMode("auto");
    }
  });

  it("a frame at or under the sample size is never sampled (no __approx)", async () => {
    calcModeStore.setMode("sketch");
    const small: FrameValue = {
      __frame: true,
      columns: [
        { name: "region", type: "string", values: ["N", "S"] },
        { name: "qty", type: "number", values: [10, 20] },
      ],
    };
    const aggs = [{ column: "qty", op: "sum" as const, as: "total" }];
    const out = await readFrame(await runFrameUnary(small, { kind: "groupBy", keys: ["region"], aggs }));
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.__approx).toBeUndefined();
    calcModeStore.setMode("auto");
  });

  it("the approx marking propagates through a non-aggregating verb chained after groupBy", async () => {
    calcModeStore.setMode("sketch");
    const aggs = [{ column: "qty", op: "sum" as const, as: "total" }];
    const grouped = await runFrameUnary(big, { kind: "groupBy", keys: ["region"], aggs });
    if (isSolError(grouped)) throw new Error("expected a ref");
    const sorted = await readFrame(await runFrameUnary(grouped, { kind: "sort", by: "total", dir: "desc" }));
    if (isSolError(sorted) || sorted == null) throw new Error("expected a frame");
    expect(sorted.__approx).toBeDefined();
    calcModeStore.setMode("auto");
  });
});

// C3.2: Replace Values' Find/Replace became `anyIn`, so a wired scalar of any type now
// connects and stringifies through readFilterValue (the kernel + Polars plan are unchanged).
describe("Replace Values — Find/Replace take a wired value of any type", () => {
  const collect = async (n: ReplaceValuesNode, inputs: Parameters<ReplaceValuesNode["data"]>[0]) =>
    readFrame((await n.data(inputs)).frame);

  it("a wired NUMBER matches a number column (was impossible on a strIn socket)", async () => {
    resetFrameBackendToJs();
    const f: FrameValue = { __frame: true, columns: [{ name: "qty", type: "number", values: [10, 20, 30] }] };
    const n = new ReplaceValuesNode({ mode: "cell" });
    n.stringLiterals.column = "qty";
    const out = await collect(n, { frame: [f], find: [20], replace: [99] });
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.columns[0].values).toEqual([10, 99, 30]);
  });

  it("a wired BOOLEAN matches a logical column", async () => {
    resetFrameBackendToJs();
    const f: FrameValue = { __frame: true, columns: [{ name: "flag", type: "logical", values: [true, false, true] }] };
    const n = new ReplaceValuesNode({ mode: "cell" });
    n.stringLiterals.column = "flag";
    const out = await collect(n, { frame: [f], find: [false], replace: [true] });
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.columns[0].values).toEqual([true, true, true]);
  });

  it("a wired-blank Find is unknown → the whole result is null", async () => {
    resetFrameBackendToJs();
    const f: FrameValue = { __frame: true, columns: [{ name: "qty", type: "number", values: [1, 2] }] };
    const n = new ReplaceValuesNode({ mode: "cell" });
    n.stringLiterals.column = "qty";
    expect((await n.data({ frame: [f], find: [null], replace: [0] })).frame).toBeNull();
  });
});
