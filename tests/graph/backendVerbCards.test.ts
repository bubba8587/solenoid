// [[C130]] rustCore, [[D99]] rustIsSpec
// The cards whose verb is a backend call of its own (Join, Append, Bind Columns) or a read of a ref's schema and
// columns (Table Size, Slicer, PIVOTBY), driven through data() over values and refs alike.
import { describe, it, expect, beforeEach } from "vitest";
import { runFrameUnary, resetFrameBackendToJs, clearCollectMemo, readFrame, isFrameRef, type FrameRef } from "../../src/graph/frameBackend";
import { JoinNode, AppendNode, BindColumnsNode, PivotNode } from "../../src/graph/nodes/frame";
import { TableInfoNode } from "../../src/graph/nodes/matrix";
import { SlicerNode } from "../../src/graph/nodes/control";
import { solError } from "../../src/graph/errorValue";
import { makeCube, type FrameValue } from "../../src/graph/frame";
import { pivotLayoutOf } from "../../src/graph/pivotLayout";

const sales: FrameValue = {
  __frame: true,
  columns: [
    { name: "Rep", type: "string", values: ["Ada", "Bo", "Ada", "Cy"] },
    { name: "Region", type: "string", values: ["N", "S", "N", "E"] },
    { name: "Amount", type: "number", values: [100, 50, 30, 200], unit: { dim: { length: 1 }, display: "km" } },
  ],
};
const reps: FrameValue = {
  __frame: true,
  columns: [
    { name: "Rep", type: "string", values: ["Ada", "Bo", "Di"] },
    { name: "Team", type: "string", values: ["Red", "Blue", "Gold"] },
  ],
};
const times: FrameValue = { __frame: true, columns: [{ name: "t", type: "number", values: [1, 5, 9] }, { name: "x", type: "number", values: [10, 50, 90] }] };
const marks: FrameValue = { __frame: true, columns: [{ name: "t", type: "number", values: [0, 4, 6] }, { name: "y", type: "string", values: ["a", "b", "c"] }] };
const mixed: FrameValue = {
  __frame: true,
  columns: [
    { name: "k", type: "string", values: ["b", "a", null, "b", "", "c", "A"] },
    { name: "n", type: "number", values: [3, 1, 2, 3, null, NaN, 10] },
    { name: "on", type: "logical", values: [true, false, true, null, true, false, true] },
  ],
};

const lazy = async (f: FrameValue) => (await runFrameUnary(f, { kind: "distinct" })) as FrameRef;
const shown = async (v: unknown) => (isFrameRef(v) ? readFrame(v) : v) as Promise<FrameValue | null>;
const cols = (f: FrameValue | null) => f && Object.fromEntries(f.columns.map((c) => [c.name, c.values]));

beforeEach(() => { resetFrameBackendToJs(); clearCollectMemo(); });

describe("Join", () => {
  const join = async (init: ConstructorParameters<typeof JoinNode>[0], keys: Record<string, string>, inputs: Record<string, unknown[]>) => {
    const n = new JoinNode(init);
    Object.assign(n.stringLiterals, keys);
    return (await n.data(inputs)).frame;
  };

  it.each(["inner", "left", "right", "outer", "semi", "anti"] as const)("%s on values and refs", async (how) => {
    const want = cols(await shown(await join({ how }, { leftKey: "Rep" }, { left: [sales], right: [reps] })));
    expect(want).not.toBeNull();
    expect(cols(await shown(await join({ how }, { leftKey: " Rep ", rightKey: "" }, { left: [await lazy(sales)], right: [await lazy(reps)] })))).toEqual(want);
  });

  it("a blank left key answers nothing, except for Cross", async () => {
    expect(await join({ how: "inner" }, { leftKey: "  " }, { left: [sales], right: [reps] })).toBeNull();
    expect(cols(await shown(await join({ how: "cross" }, {}, { left: [times], right: [marks] })))?.t).toHaveLength(9);
  });

  it("a missing side or a wired blank key answers nothing", async () => {
    expect(await join({}, { leftKey: "Rep" }, { left: [sales] })).toBeNull();
    expect(await join({}, { leftKey: "Rep" }, { left: [sales], right: [null] })).toBeNull();
    expect(await join({}, {}, { left: [sales], right: [reps], leftKey: [null] })).toBeNull();
    expect(await join({}, { leftKey: "Rep" }, { left: [sales], right: [reps], rightKey: [null] })).toBeNull();
  });

  it("a wired key names the column", async () => {
    expect(cols(await shown(await join({ how: "semi" }, {}, { left: [sales], right: [reps], leftKey: ["Rep"], rightKey: ["Rep"] })))?.Rep).toEqual(["Ada", "Bo", "Ada"]);
  });

  it("Tolerance is read only by as-of", async () => {
    expect(await join({ how: "asof" }, { leftKey: "t" }, { left: [times], right: [marks], tolerance: [null] })).toBeNull();
    expect(await join({ how: "inner" }, { leftKey: "t" }, { left: [times], right: [marks], tolerance: [null] })).not.toBeNull();
    for (const asofDirection of ["backward", "forward", "nearest"] as const) {
      const all = cols(await shown(await join({ how: "asof", asofDirection }, { leftKey: "t" }, { left: [times], right: [marks] })));
      const near = cols(await shown(await join({ how: "asof", asofDirection }, { leftKey: "t" }, { left: [times], right: [marks], tolerance: [1] })));
      expect(all?.y).toHaveLength(3);
      expect(near?.y).toHaveLength(3);
    }
  });

  it("a join the backend refuses answers its error", async () => {
    const out = await join({}, { leftKey: "Nope" }, { left: [sales], right: [reps] });
    expect((out as { code?: string }).code).toBe("#REF!");
    const typed = await join({}, { leftKey: "Rep", rightKey: "Amount" }, { left: [reps], right: [sales] });
    expect((typed as { code?: string }).code).toBe("#TYPE!");
  });

  it("a key that isn't text fails the card", async () => {
    await expect(join({}, {}, { left: [sales], right: [reps], leftKey: [3] })).rejects.toThrow();
    await expect(join({}, { leftKey: "Rep" }, { left: [sales], right: [reps], rightKey: [true] })).rejects.toThrow();
  });
});

describe.each([["Append", AppendNode], ["Bind Columns", BindColumnsNode]] as const)("%s", (_name, Card) => {
  const run = async (inputs: Record<string, unknown[]>, keys?: string[]) => (await new Card({ valueKeys: keys }).data(inputs)).frame;

  it("nothing wired answers nothing", async () => {
    expect(await run({})).toBeNull();
    expect(await run({ f0: [null], f1: [] })).toBeNull();
  });

  it("one frame passes through: a value as itself, a ref as a plan on it", async () => {
    expect(await run({ f1: [sales] })).toBe(sales);
    const ref = await lazy(reps);
    const out = await run({ f0: [ref] });
    expect(isFrameRef(out) && out.__frameRef).toBe(ref.__frameRef);
    expect(cols(await shown(out))).toEqual(cols(reps));
  });

  it("frames combine in socket order, an unwired socket skipped", async () => {
    const out = await run({ f0: [times], f2: [await lazy(marks)] }, ["f0", "f1", "f2"]);
    expect(cols(await shown(out))).not.toBeNull();
    const flipped = await run({ f2: [times], f0: [marks] }, ["f0", "f1", "f2"]);
    expect(cols(await shown(flipped))).not.toEqual(cols(await shown(out)));
  });

  it("three frames, values and refs", async () => {
    const out = await run({ f0: [sales], f1: [await lazy(sales)], f2: [sales] }, ["f0", "f1", "f2"]);
    expect((await shown(out))?.columns.length).toBeGreaterThan(0);
  });
});

describe("Table Size", () => {
  const size = async (v: unknown, wired = true) => {
    const n = new TableInfoNode();
    const out = await n.data(wired ? { matrix: [v] } : {});
    return [out.rows, out.cols, n.cachedRows, n.cachedCols];
  };

  it("counts a frame, held or lazy, without its cells", async () => {
    expect(await size(sales)).toEqual([4, 3, 4, 3]);
    expect(await size(await lazy(sales))).toEqual([4, 3, 4, 3]);
    expect(await size({ __frame: true, columns: [] })).toEqual([0, 0, 0, 0]);
    expect(await size(await lazy({ __frame: true, columns: [{ name: "a", type: "number", values: [] }] }))).toEqual([0, 1, 0, 1]);
    expect(await size({ ...sales, __totalRows: 900 })).toEqual([900, 3, 900, 3]);
  });

  it("counts a table, a list and a value", async () => {
    expect(await size([[1, 2, 3], [4, 5, 6]])).toEqual([2, 3, 2, 3]);
    expect(await size(["a", "b"])).toEqual([1, 2, 1, 2]);
    expect(await size(7)).toEqual([1, 1, 1, 1]);
    expect(await size([])).toEqual([0, 0, 0, 0]);
    expect((await size(null)).slice(0, 2)).toEqual([null, null]);
    expect((await size(undefined, false)).slice(0, 2)).toEqual([null, null]);
  });

  it("a ref whose plan fails answers its error", async () => {
    const bad = (await runFrameUnary(sales, { kind: "select", columns: ["Nope"] })) as FrameRef;
    const [rows, colsOut, cr, cc] = await size(bad);
    expect((rows as { code?: string }).code).toBe("#REF!");
    expect(colsOut).toBe(rows);
    expect([cr, cc]).toEqual([null, null]);
  });
});

describe("Slicer", () => {
  const slice = async (f: unknown, init: ConstructorParameters<typeof SlicerNode>[0] = {}) => {
    const n = new SlicerNode(init);
    const out = await n.data({ frame: [f] });
    return { n, out: await shown(out.result) };
  };

  it.each([false, true])("lists a column's values in order and filters to the picked ones (lazy %s)", async (isLazy) => {
    const src = isLazy ? await lazy(mixed) : mixed;
    const k = await slice(src, { selectedColumn: "k" });
    expect(k.n.cachedColumns).toEqual(["k", "n", "on"]);
    expect(k.n.cachedColumnType).toBe("string");
    expect(k.n.cachedUniqueValues).toEqual(["A", "a", "b", "c"]);
    expect(cols(k.out)).toEqual(cols(mixed));
    const picked = await slice(src, { selectedColumn: "k", selectedValues: ["b", "A"] });
    expect(cols(picked.out)?.k).toEqual(["b", "b", "A"]);
    const nums = await slice(src, { selectedColumn: "n", selectedValues: [3, 10] });
    expect(nums.n.cachedColumnType).toBe("number");
    expect(cols(nums.out)?.n).toEqual([3, 3, 10]);
  });

  it.each([false, true])("reads the first column when the picked one is gone (lazy %s)", async (isLazy) => {
    const s = await slice(isLazy ? await lazy(mixed) : mixed, { selectedColumn: "gone", selectedValues: ["a"] });
    expect(s.n.cachedUniqueValues).toEqual(["A", "a", "b", "c"]);
    expect(cols(s.out)?.k).toEqual(["a"]);
  });

  it("orders numbers by value and the rest as text", async () => {
    const f: FrameValue = { __frame: true, columns: [{ name: "v", type: "number", values: [10, 9, 100, -1, 9, 0.5] }] };
    expect((await slice(f)).n.cachedUniqueValues).toEqual([-1, 0.5, 9, 10, 100]);
    const logical = await slice(mixed, { selectedColumn: "on" });
    expect(logical.n.cachedUniqueValues).toEqual([false, true]);
  });

  it("an empty frame or none passes through, its values cleared", async () => {
    const none = await slice(null);
    expect(none.out).toBeNull();
    expect(none.n.cachedColumns).toEqual([]);
    expect(none.n.cachedUniqueValues).toEqual([]);
    const empty: FrameValue = { __frame: true, columns: [] };
    expect((await slice(empty)).out).toEqual(empty);
    const lazyEmpty = await slice(await lazy({ __frame: true, columns: [] }), { selectedValues: [1] });
    expect(lazyEmpty.n.cachedUniqueValues).toEqual([]);
  });

  it("a ref whose schema can't be read passes on, and its preview fails the card", async () => {
    const bad = (await runFrameUnary(mixed, { kind: "select", columns: ["Nope"] })) as FrameRef;
    await expect(slice(bad, { selectedValues: ["a"] })).rejects.toThrow();
  });

  it("a value keeps a text pick of a number column apart from the number", async () => {
    const s = await slice(mixed, { selectedColumn: "n", selectedValues: ["3"] });
    expect(cols(s.out)?.n).toEqual([]);
  });
});

describe("PIVOTBY beyond the field filter", () => {
  const pivot = (init: ConstructorParameters<typeof PivotNode>[0] = {}) => new PivotNode(init);

  it("pivots a lazy frame as it pivots the value", async () => {
    const lits = { rowFields: [["Rep"]], colFields: [["Region"]], values: [["Amount"]] };
    const held = await pivot({ rowTotalDepth: 1 }).data({ frame: [sales], ...lits });
    const n = pivot({ rowTotalDepth: 1 });
    const fromRef = await n.data({ frame: [await lazy(sales)], ...lits });
    expect(cols(fromRef.frame as FrameValue)).toEqual(cols(held.frame as FrameValue));
    const wide = fromRef.frame as FrameValue;
    expect(wide.columns[wide.columns.length - 1].unit).toEqual(sales.columns[2].unit);
    expect(pivotLayoutOf(fromRef.frame as FrameValue)?.rows.length).toBe((fromRef.frame as FrameValue).columns[0].values.length);
    expect(n.sourceColumns.map((c) => c.distinct.length)).toEqual([3, 3, 4]);
  });

  it("a lazy frame with no value fields passes on", async () => {
    const ref = await lazy(sales);
    const n = pivot();
    const out = await n.data({ frame: [ref], rowFields: [["Rep"]] });
    expect(isFrameRef(out.frame) && out.frame.__frameRef).toBe(ref.__frameRef);
    expect(n.sourceColumns.map((c) => c.distinct)).toEqual([["Ada", "Bo", "Cy"], [], []]);
  });

  it("a ref that can't be read answers its error", async () => {
    const bad = (await runFrameUnary(sales, { kind: "select", columns: ["Nope"] })) as FrameRef;
    const n = pivot();
    const out = await n.data({ frame: [bad], rowFields: [["Rep"]], values: [["Amount"]] });
    expect((out.frame as { code?: string }).code).toBe("#REF!");
    expect(n.sourceColumns).toEqual([]);
  });

  it("drops saved fields the frame no longer has", async () => {
    const n = pivot({ funcs: { Amount: "avg", Gone: "max" }, filterExclude: { Gone: ["x"], Region: ["E"] }, detailFields: ["Gone", "Region"] });
    n.stringLiterals = { rowFields: "Rep,Gone", colFields: "", values: "Amount" };
    const out = await n.data({ frame: [sales], rowFields: [["Rep", "Gone"]], values: [["Amount"]] });
    expect(n.stringLiterals.rowFields).toBe("Rep");
    expect(n.funcs).toEqual({ Amount: "avg" });
    expect(n.filterExclude).toEqual({ Region: ["E"] });
    expect(n.detailFields).toEqual(["Region"]);
    expect(cols(out.frame as FrameValue)?.Amount).toEqual([65, 50]);
  });

  it("pivots a cube's flat columns", async () => {
    const cube = makeCube([
      { name: "g", cells: ["x", "y", "x"] },
      { name: "v", cells: [1, 2, 3] },
      { name: "nested", cells: [[1], [2], [3]] },
    ]);
    const n = pivot({ agg: "count" });
    const out = await n.data({ frame: [cube], rowFields: [["g"]], values: [["v"]] });
    expect(cols(out.frame as FrameValue)?.v).toEqual([2, 1]);
    expect(n.sourceColumns.map((c) => c.name)).toEqual(["g", "v"]);
  });

  it("a wired blank list answers nothing, a missing value field passes the frame", async () => {
    expect((await pivot().data({ frame: [sales], rowFields: [null], values: [["Amount"]] })).frame).toBeNull();
    expect((await pivot().data({ frame: [sales], values: [["Gone"]] })).frame).toEqual(sales);
    expect((await pivot().data({})).frame).toBeNull();
  });

  it("a key cell holding an error keys the filter by its code", async () => {
    const f: FrameValue = { __frame: true, columns: [
      { name: "k", type: "number", values: [1, solError("#N/A", "x"), true as never, 1] },
      { name: "v", type: "number", values: [1, 2, 3, 4] },
    ] };
    const n = pivot({ filterExclude: { k: ["#N/A"] } });
    const out = await n.data({ frame: [f], rowFields: [["k"]], values: [["v"]] });
    expect(n.sourceColumns[0].distinct).toEqual(["1", "#N/A", "TRUE"]);
    expect(cols(out.frame as FrameValue)?.v).toEqual([5, 3]);
  });
});
