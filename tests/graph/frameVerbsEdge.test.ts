// [[C45]], [[C16]], [[C24]]
// Degenerate-input hardening for the verb engine: empty frames, ragged columns,
// all-null keys, zero-take. The nodes will lean on these never throwing on edge
// shapes (an empty upstream frame is common mid-build), so pin the behavior.
import { describe, it, expect } from "vitest";
import {
  selectColumns, dropColumns, renameColumns, sortByColumn, distinctRows, headRows,
  filterRows, groupByFrame, joinFrames, appendFrames, pivotFrame, unpivotFrame,
  nestFrame, windowFrame,
} from "../../src/graph/frameVerbs";
import { frameRowCount, type FrameValue } from "../../src/graph/frame";

const empty: FrameValue = {
  __frame: true,
  columns: [{ name: "a", type: "number", values: [] }, { name: "b", type: "string", values: [] }],
};
const one: FrameValue = {
  __frame: true,
  columns: [{ name: "a", type: "number", values: [7] }, { name: "b", type: "string", values: ["q"] }],
};

describe("verbs on an empty frame (0 rows) — never throw, keep schema", () => {
  it("row verbs return 0 rows", () => {
    expect(frameRowCount(sortByColumn(empty, "a", "asc"))).toBe(0);
    expect(frameRowCount(distinctRows(empty))).toBe(0);
    expect(frameRowCount(headRows(empty, 5))).toBe(0);
    expect(frameRowCount(filterRows(empty, "a", "gt", 0))).toBe(0);
  });
  it("schema verbs still reshape columns", () => {
    expect(selectColumns(empty, ["b"]).columns.map((c) => c.name)).toEqual(["b"]);
    expect(dropColumns(empty, ["a"]).columns.map((c) => c.name)).toEqual(["b"]);
    expect(renameColumns(empty, { a: "x" }).columns[0].name).toBe("x");
  });
  it("groupBy of nothing is an empty grouping with the right columns", () => {
    const g = groupByFrame(empty, ["b"], [{ column: "a", op: "sum", as: "s" }]);
    expect(g.columns.map((c) => c.name)).toEqual(["b", "s"]);
    expect(frameRowCount(g)).toBe(0);
  });
  it("pivot/unpivot of nothing don't throw", () => {
    expect(frameRowCount(pivotFrame(empty, { rowFields: ["a"], colFields: ["b"], values: ["a"], funcs: ["sum"] }))).toBe(0);
    expect(frameRowCount(unpivotFrame(empty, ["a"], ["b"]))).toBe(0);
  });
  it("nest of nothing yields a 0-row cube with the key + nested columns", () => {
    const c = nestFrame(empty, ["a"], "items");
    expect(c.columns.map((col) => col.name)).toEqual(["a", "items"]);
  });
});

describe("join with an empty side", () => {
  it("inner with empty right is empty; left keeps all left rows with null right", () => {
    const inner = joinFrames(one, empty, { leftKey: "a", rightKey: "a", how: "inner" });
    expect(frameRowCount(inner)).toBe(0);
    const left = joinFrames(one, empty, { leftKey: "a", rightKey: "a", how: "left" });
    expect(left.columns[0].values).toEqual([7]);
    expect(left.columns[1].values).toEqual(["q"]); // left.b
    expect(left.columns[2].values).toEqual([null]); // empty.b, unmatched
  });
});

describe("ragged + all-null", () => {
  it("a column shorter than rowCount pads with null through a row verb", () => {
    const ragged: FrameValue = {
      __frame: true,
      columns: [{ name: "a", type: "number", values: [1, 2, 3] }, { name: "b", type: "number", values: [9] }],
    };
    const out = headRows(ragged, 3);
    expect(out.columns[1].values).toEqual([9, null, null]);
  });
  it("an all-null key column matches nothing in a join (null != null)", () => {
    const nullsL: FrameValue = { __frame: true, columns: [{ name: "k", type: "number", values: [null, null] }] };
    const nullsR: FrameValue = { __frame: true, columns: [{ name: "k", type: "number", values: [null] }] };
    expect(frameRowCount(joinFrames(nullsL, nullsR, { leftKey: "k", rightKey: "k", how: "inner" }))).toBe(0);
  });
  it("append of two empty frames is an empty frame with the union schema", () => {
    const out = appendFrames([empty, { __frame: true, columns: [{ name: "c", type: "number", values: [] }] }]);
    expect(out.columns.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(frameRowCount(out)).toBe(0);
  });
});

describe("window over one large partition", () => {
  it("runs in linear time and never spreads the partition into Math.min", () => {
    const n = 200_000;
    const f: FrameValue = { __frame: true, columns: [{ name: "v", type: "number", values: Array.from({ length: n }, (_, i) => i % 7) }] };
    for (const fn of ["group_min", "cummax", "cumsum", "dense_rank", "rank"] as const) {
      const out = windowFrame(f, { partitionBy: [], orderBy: "v", fn, column: "v", as: "w" });
      expect(out.columns[1].values.length).toBe(n);
    }
    const ranks = windowFrame(f, { partitionBy: [], orderBy: "v", fn: "dense_rank", as: "w" }).columns[1].values;
    expect(ranks[6]).toBe(7);
  }, 10_000);
});

describe("aggregates over one large group", () => {
  it("never spread the group into a call", () => {
    const n = 200_000;
    const f: FrameValue = {
      __frame: true,
      columns: [
        { name: "k", type: "string", values: Array.from({ length: n }, () => "a") },
        { name: "v", type: "number", values: Array.from({ length: n }, (_, i) => i % 7) },
      ],
    };
    const ops = ["sum", "avg", "min", "max", "product", "median", "mode", "stdev", "stdevp", "var", "varp"] as const;
    const g = groupByFrame(f, ["k"], ops.map((op) => ({ column: "v", op, as: op })));
    const at = (op: string) => g.columns.find((c) => c.name === op)!.values[0];
    for (const op of ops) expect(typeof at(op), op).toBe("number");
    expect([at("sum"), at("min"), at("max"), at("product"), at("median")]).toEqual([599_994, 0, 6, 0, 3]);
  }, 10_000);
});
