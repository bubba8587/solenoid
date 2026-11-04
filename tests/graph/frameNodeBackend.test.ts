// [[C130]] rustCore, [[C24]] arraySemantics, [[C23]] calcModes, [[frame-verbs#Readers]], [[frame-verbs#Sketch mode and the aggregate guard]]
import { describe, it, expect, beforeEach } from "vitest";
import { readFrame, collectPreview } from "../../src/graph/frameBackend";
import { planned, SKETCH_SAMPLE_ROWS } from "./frameRefKit";
import { JoinNode, AppendNode } from "../../src/graph/nodes/frame";
import { calcModeStore } from "../../src/graph/calcModeStore";
import { ReplaceValuesNode } from "../../src/graph/nodes/frame";
import { takesAutoLiteral, takesTextLiteral } from "../../src/graph/components/inlineInput";
import { type FrameOp, type JoinOpts } from "../../src/graph/frameOps";
import { selectColumns, dropColumns, renameColumns, sortByColumn, distinctRows, headRows, filterRows, groupByFrame, pivotFrame, unpivotFrame, joinFrames, appendFrames } from "./coreVerbs";

const u = async (op: FrameOp) => readFrame(planned(sample, op));
const runFrameJoin = (left: FrameValue, right: FrameValue, opts: JoinOpts) => {
  const n = new JoinNode({ how: opts.how });
  Object.assign(n.stringLiterals, { leftKey: opts.leftKey, rightKey: opts.rightKey });
  return n.data({ left: [left], right: [right] }).frame;
};
const runFrameAppend = (frames: FrameValue[]) => new AppendNode().data({ f0: [frames[0]], f1: [frames[1]] }).frame;
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

describe("a plan — parity with each pure verb", () => {
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

describe("Join / Append — parity", () => {
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

describe("sketch mode — sampled verb execution + extrapolated aggregates", () => {
  const big: FrameValue = {
    __frame: true,
    columns: [
      { name: "region", type: "string", values: Array.from({ length: SKETCH_SAMPLE_ROWS * 2 }, (_, i) => (i % 2 === 0 ? "N" : "S")) },
      { name: "qty", type: "number", values: Array.from({ length: SKETCH_SAMPLE_ROWS * 2 }, () => 1) },
    ],
  };

  beforeEach(() => {
    calcModeStore.setMode("auto"); // also clears dirty; leaves sketch off
  });

  it("auto mode (sketch off) computes the exact sum over every row", async () => {
    const aggs = [{ column: "qty", op: "sum" as const, as: "total" }];
    const out = await readFrame(planned(big, { kind: "groupBy", keys: ["region"], aggs }));
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
    const out = await readFrame(planned(big, { kind: "groupBy", keys: ["region"], aggs }));
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.__approx!.factor).toBeCloseTo(2, 5); // 2×SKETCH_SAMPLE_ROWS rows sampled to SKETCH_SAMPLE_ROWS
    const total = out.columns.find((c) => c.name === "total")!.values.reduce((a, b) => (a as number) + (b as number), 0);
    expect(total).toBeCloseTo(SKETCH_SAMPLE_ROWS * 2, 5);
    for (const v of out.columns.find((c) => c.name === "avg")!.values) expect(v).toBe(1);
    calcModeStore.setMode("auto");
  });

  it("a truncated card preview is scaled like the full collect", async () => {
    calcModeStore.setMode("sketch");
    const rows = SKETCH_SAMPLE_ROWS * 2;
    const wide: FrameValue = { __frame: true, columns: [
      { name: "id", type: "number", values: Array.from({ length: rows }, (_, i) => i) },
      { name: "qty", type: "number", values: Array.from({ length: rows }, () => 1) },
    ] };
    const ref = planned(wide, { kind: "groupBy", keys: ["id"], aggs: [{ column: "qty", op: "sum", as: "total" }] });
    const prev = await collectPreview(ref);
    if (isSolError(prev) || prev == null) throw new Error("expected a frame");
    expect(prev.__totalRows).toBeDefined(); // the preview really is truncated
    expect(prev.__approx).toBeDefined();
    for (const v of prev.columns.find((c) => c.name === "total")!.values) expect(v).toBeCloseTo(2, 5);
    calcModeStore.setMode("auto");
  });

  it("F9 (beginForceExact/endForceExact) forces an exact pass even while sketch mode is selected", async () => {
    calcModeStore.setMode("sketch");
    calcModeStore.beginForceExact();
    try {
      const aggs = [{ column: "qty", op: "sum" as const, as: "total" }];
      const out = await readFrame(planned(big, { kind: "groupBy", keys: ["region"], aggs }));
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
    const out = await readFrame(planned(small, { kind: "groupBy", keys: ["region"], aggs }));
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.__approx).toBeUndefined();
    calcModeStore.setMode("auto");
  });

  it("the approx marking propagates through a non-aggregating verb chained after groupBy", async () => {
    calcModeStore.setMode("sketch");
    const aggs = [{ column: "qty", op: "sum" as const, as: "total" }];
    const grouped = planned(big, { kind: "groupBy", keys: ["region"], aggs });
    if (isSolError(grouped)) throw new Error("expected a ref");
    const sorted = await readFrame(planned(grouped, { kind: "sort", by: "total", dir: "desc" }));
    if (isSolError(sorted) || sorted == null) throw new Error("expected a frame");
    expect(sorted.__approx).toBeDefined();
    calcModeStore.setMode("auto");
  });
});

describe("Replace Values — Find/Replace take a wired value of any type", () => {
  const collect = async (n: ReplaceValuesNode, inputs: Parameters<ReplaceValuesNode["data"]>[0]) =>
    readFrame((await n.data(inputs)).frame);

  it("a wired NUMBER matches a number column", async () => {
    const f: FrameValue = { __frame: true, columns: [{ name: "qty", type: "number", values: [10, 20, 30] }] };
    const n = new ReplaceValuesNode({ mode: "cell" });
    n.stringLiterals.column = "qty";
    const out = await collect(n, { frame: [f], find: [20], replace: [99] });
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.columns[0].values).toEqual([10, 99, 30]);
  });

  it("a wired BOOLEAN matches a logical column", async () => {
    const f: FrameValue = { __frame: true, columns: [{ name: "flag", type: "logical", values: [true, false, true] }] };
    const n = new ReplaceValuesNode({ mode: "cell" });
    n.stringLiterals.column = "flag";
    const out = await collect(n, { frame: [f], find: [false], replace: [true] });
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.columns[0].values).toEqual([true, true, true]);
  });


  it("the card's typed Find and Replace are text kept exactly as typed", async () => {
    const n = new ReplaceValuesNode({ mode: "substring" });
    expect(takesAutoLiteral(n, "any")).toBe(false);
    expect(takesTextLiteral(n, "any")).toBe(true);
    const f: FrameValue = { __frame: true, columns: [{ name: "s", type: "string", values: ["a_b", "007"] }] };
    n.stringLiterals.find = "_";
    n.stringLiterals.replace = " ";
    const out = await collect(n, { frame: [f] });
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    expect(out.columns[0].values).toEqual(["a b", "007"]);
  });
});

describe("the aggregate guard on a collected groupBy", () => {
  const big = (values: number[]): FrameValue => ({ __frame: true, columns: [
    { name: "s", type: "string", values: values.map(() => "a") }, { name: "n", type: "number", values }] });
  const sum = async (values: number[]) => {
    const out = await readFrame(planned(big(values), { kind: "groupBy", keys: ["s"], aggs: [{ column: "n", op: "sum", as: "total" }] }));
    if (isSolError(out) || out == null) throw new Error("expected a frame");
    return out.columns[1].values[0];
  };

  it("a sum past the largest double from finite cells is #OVERFLOW!", async () => {
    expect(await sum([1e308, 1e308])).toMatchObject({ code: "#OVERFLOW!" });
  });

  it("a sum over an infinite cell stays infinite", async () => {
    expect(await sum([Infinity, 5])).toBe(Infinity);
  });
});
