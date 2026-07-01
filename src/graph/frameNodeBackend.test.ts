// The node-facing verb runners (runFrameUnary/Join/Append) + collect, on the JS
// backend (the web path + the Polars oracle). Each runner must produce EXACTLY what
// the pure verb produces — that's what guarantees the migrated frame nodes behave
// identically to the old direct-verb path. A structural failure comes back as a
// tagged SolError VALUE, never a throw.
import { describe, it, expect } from "vitest";
import { runFrameUnary, runFrameJoin, runFrameAppend, readFrame, frameBackend, resetFrameBackendToJs } from "./frameBackend";
import {
  selectColumns, dropColumns, renameColumns, sortByColumn, distinctRows, headRows,
  filterRows, groupByFrame, pivotFrame, unpivotFrame, joinFrames, appendFrames,
  type FrameOp, type JoinOpts,
} from "./frameVerbs";

// The runners now return a LAZY ref (the result stays in the backend); collect it
// back to compare against the pure verb. (An op that fails returns a SolError VALUE
// directly — not a ref — so the error case below reads runFrameUnary without collect.)
const u = async (op: FrameOp) => readFrame(await runFrameUnary(sample, op));
import { isSolError } from "./errorValue";
import type { FrameValue } from "./frame";

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
