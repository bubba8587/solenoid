import { describe, it, expect } from "vitest";
import { sortByColumn, distinctRows, filterRows, filterRowsMulti, groupByFrame, unpivotFrame, pivotFrame, nestFrame, unnestCube, splitColumn, addIndexColumn, lookupFrameCell, fillBlanks, replaceValues, mergeColumns, promoteHeaders, demoteHeaders, dropBlankRows, sliceRows } from "./frameVerbs";
import { isSolError, solError } from "./errorValue";
import { isCubeValue, isFrameValue, cubeFromColumns, cubeDepth, cubeRowCount, type FrameValue } from "./frame";

const f: FrameValue = {
  __frame: true,
  columns: [
    { name: "id", type: "number", values: [1, 2, 3] },
    { name: "name", type: "string", values: ["a", "b", "c"] },
    { name: "qty", type: "number", values: [10, 20, 30] },
  ],
};

// The verb-semantics tests live in fixtures/frame-verbs (the parity corpus —
// frameVerbCorpus.test.ts runs them here, cargo's corpus_cases runs the same
// files through Polars). What remains below is ORACLE-ONLY behavior: per-cell
// SolErrors can't ride the wire (the {"__err"} upload degrades them to null
// engine-side), so their semantics are pinned here and nowhere else.

describe("sort — error cells (oracle-only)", () => {
  const s: FrameValue = {
    __frame: true,
    columns: [
      { name: "k", type: "number", values: [3, 1, null, 2, solError("#DIV/0!", "x")] },
      { name: "tag", type: "string", values: ["c", "a", "z", "b", "e"] },
    ],
  };
  it("orders ascending with blanks + errors last", () => {
    const out = sortByColumn(s, "k", "asc");
    expect(out.columns[0].values).toEqual([1, 2, 3, null, expect.objectContaining({ code: "#DIV/0!" })]);
    expect(out.columns[1].values.slice(0, 3)).toEqual(["a", "b", "c"]); // rows moved together
  });
  it("descending also keeps blanks/errors last", () => {
    const out = sortByColumn(s, "k", "desc");
    expect(out.columns[0].values.slice(0, 3)).toEqual([3, 2, 1]);
    expect(out.columns[0].values[3]).toBeNull();
    expect(isSolError(out.columns[0].values[4])).toBe(true);
  });
});

describe("distinct — the cross-backend key contract (B-1a, re-cut 2026-08-22)", () => {
  // Rust keys rows with serde_json of the SAME tagged tuples this oracle builds,
  // asserted byte-identical in engine/tests.rs `row_key_is_byte_identical_to_js_
  // json_stringify` against this exact literal. If encodeCell's encoding ever
  // changes, update BOTH pins together. (Key BEHAVIOR — a bucket per non-finite,
  // the \u0001 separator class, null bucketing — is corpus-pinned.)
  it("the tagged-tuple key literal both backends pin (incl. \\u0001 + -0)", () => {
    const literal = JSON.stringify([["s", "a\u0001b"], ["#", 1], ["#", -0], ["b", true], ["n"]]);
    expect(literal).toBe('[["s","a\\u0001b"],["#",1],["#",0],["b",true],["n"]]');
  });
  it("+∞, −∞ and NaN key apart from each other and from null", () => {
    const nf: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [Infinity, -Infinity, NaN, null, Infinity, NaN, null, 1] }],
    };
    expect(distinctRows(nf).columns[0].values).toEqual([Infinity, -Infinity, NaN, null, 1]);
  });
  it("the non-finite tokens cannot collide with the strings that name them", () => {
    const mixed: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "string", values: ["inf", "-inf", "nan", "inf"] }],
    };
    expect(distinctRows(mixed).columns[0].values).toEqual(["inf", "-inf", "nan"]);
  });
});
describe("filter — error cells (oracle-only)", () => {
  const t: FrameValue = {
    __frame: true,
    columns: [
      { name: "qty", type: "number", values: [5, 12, null, 20, solError("#DIV/0!", "x")] },
      { name: "city", type: "string", values: ["Oslo", "Bergen", "Oslo", "Tromso", "Oslo"] },
    ],
  };
  it("an error cell fails every comparison, like null", () => {
    const out = filterRows(t, "qty", "gte", 5);
    expect(out.columns[0].values).toEqual([5, 12, 20]);
  });
  it("an error cell is present, not blank: isblank false, notblank true", () => {
    const blank = filterRows(t, "qty", "isblank", null);
    expect(blank.columns[1].values).toEqual(["Oslo"]);
    const present = filterRows(t, "qty", "notblank", null);
    expect(present.columns[1].values).toEqual(["Oslo", "Bergen", "Tromso", "Oslo"]);
    // Kept + Dropped stays an exhaustive complement (filterOneJob).
    expect(blank.columns[0].values.length + present.columns[0].values.length).toBe(5);
  });
  it("an error cell in a NON-filtered column rides along untouched", () => {
    expect(filterRows(t, "city", "eq", "Oslo").columns[0].values).toEqual([5, null, solError("#DIV/0!", "x")]);
  });
});

describe("filterMulti — error cells (oracle-only)", () => {
  const t: FrameValue = {
    __frame: true,
    columns: [
      { name: "qty", type: "number", values: [5, 12, null, 20, solError("#DIV/0!", "x")] },
      { name: "city", type: "string", values: ["Oslo", "Bergen", "Oslo", "Tromso", "Oslo"] },
    ],
  };
  it("an error cell fails ITS condition only — OR can still keep the row", () => {
    const out = filterRowsMulti(t, "or", [
      { column: "qty", op: "gte", value: 0 },       // null + error rows fail here
      { column: "city", op: "eq", value: "oslo" },  // …but two of them are Oslo
    ]);
    expect(out.columns[1].values).toEqual(["Oslo", "Bergen", "Oslo", "Tromso", "Oslo"]);
  });
  it("error rows land in the complement (row complement, not predicate negation)", () => {
    const conditions = [{ column: "qty", op: "gte" as const, value: 15 }];
    const kept = filterRowsMulti(t, "and", conditions);
    const dropped = filterRowsMulti(t, "and", conditions, true);
    expect(kept.columns[0].values.length + dropped.columns[0].values.length)
      .toBe(t.columns[0].values.length);
    expect(dropped.columns[1].values).toEqual(["Oslo", "Bergen", "Oslo", "Oslo"]);
  });
});

describe("groupBy — error cells + the aggregate guard", () => {
  const g: FrameValue = {
    __frame: true,
    columns: [
      { name: "city", type: "string", values: ["Oslo", "Bergen", "Oslo", "Oslo", "Bergen"] },
      { name: "amt", type: "number", values: [10, 5, 20, null, solError("#DIV/0!", "x")] },
    ],
  };
  it("a per-cell error propagates into its group's sum and avg; count skips only null", () => {
    const out = groupByFrame(g, ["city"], [
      { column: "amt", op: "sum", as: "total" },
      { column: "amt", op: "avg", as: "mean" },
      { column: "amt", op: "count", as: "n" },
    ]);
    expect(out.columns[1].values[0]).toBe(30);               // 10 + 20 (null skipped)
    expect(isSolError(out.columns[1].values[1])).toBe(true); // 5 + error → error propagates
    expect(isSolError(out.columns[2].values[1])).toBe(true);
    expect(out.columns[3].values).toEqual([2, 2]);           // present (non-null) cells per group
  });
  // ── The aggregate non-finite guard (B-1b, decided 2026-07-02). The ENGINE
  // guards identically since 2026-07-29 (guard_agg_expr, payload-NaN markers →
  // the {"__err"} download form) — parity is pinned by the corpus's "the
  // aggregate guard" cases in groupBy.json. Input-error PROPAGATION (the test
  // above) stays oracle-only: uploads degrade error cells to null. ────────────
  it("sum overflowing from ALL-FINITE inputs → #OVERFLOW!, never a silent Infinity", () => {
    const big: FrameValue = {
      __frame: true,
      columns: [
        { name: "g", type: "string", values: ["a", "a"] },
        { name: "v", type: "number", values: [1e308, 1e308] },
      ],
    };
    const out = groupByFrame(big, ["g"], [{ column: "v", op: "sum", as: "t" }]);
    const cell = out.columns[1].values[0];
    expect(isSolError(cell) && cell.code).toBe("#OVERFLOW!");
  });
  it("∞ + −∞ → NaN result → #DOMAIN! (indeterminate, even with infinite inputs)", () => {
    const mixed: FrameValue = {
      __frame: true,
      columns: [
        { name: "g", type: "string", values: ["a", "a"] },
        { name: "v", type: "number", values: [Infinity, -Infinity] },
      ],
    };
    const out = groupByFrame(mixed, ["g"], [{ column: "v", op: "sum", as: "t" }]);
    const cell = out.columns[1].values[0];
    expect(isSolError(cell) && cell.code).toBe("#DOMAIN!");
  });
});

describe("lookupFrameCell — approximate match (XLOOKUP match_mode -1/1)", () => {
  const prices: FrameValue = {
    __frame: true,
    columns: [
      { name: "qty", type: "number", values: [1, 10, 50, 100] },
      { name: "discount", type: "number", values: [0, 0.05, 0.1, 0.2] },
    ],
  };

  it("exact mode (default) only matches an equal cell", () => {
    expect(lookupFrameCell(prices, "qty", "discount", "10")).toBe(0.05);
    expect(lookupFrameCell(prices, "qty", "discount", "20")).toBeUndefined();
  });

  it("nextSmaller: exact match wins, else the closest smaller key", () => {
    expect(lookupFrameCell(prices, "qty", "discount", "10", "nextSmaller")).toBe(0.05); // exact
    expect(lookupFrameCell(prices, "qty", "discount", "20", "nextSmaller")).toBe(0.05); // between 10 and 50
    expect(lookupFrameCell(prices, "qty", "discount", "0", "nextSmaller")).toBeUndefined(); // below every key
  });

  it("nextLarger: exact match wins, else the closest larger key", () => {
    expect(lookupFrameCell(prices, "qty", "discount", "10", "nextLarger")).toBe(0.05); // exact
    expect(lookupFrameCell(prices, "qty", "discount", "20", "nextLarger")).toBe(0.1); // between 10 and 50
    expect(lookupFrameCell(prices, "qty", "discount", "1000", "nextLarger")).toBeUndefined(); // above every key
  });

  it("approximate mode requires a numeric/date column", () => {
    const named: FrameValue = { __frame: true, columns: [{ name: "n", type: "string", values: ["a", "b"] }, { name: "v", type: "number", values: [1, 2] }] };
    const err = (() => { try { lookupFrameCell(named, "n", "v", "a", "nextSmaller"); } catch (e) { return e; } })();
    expect(isSolError(err) && err.code).toBe("#VALUE!");
  });
});

describe("unpivot / pivot (reshape)", () => {
  const wide: FrameValue = {
    __frame: true,
    columns: [
      { name: "city", type: "string", values: ["Oslo", "Bergen"] },
      { name: "jan", type: "number", values: [1, 3] },
      { name: "feb", type: "number", values: [2, 4] },
    ],
  };
  it("pivot is the inverse of unpivot: long → wide recovers the matrix", () => {
    const long = unpivotFrame(wide, ["city"], ["jan", "feb"]);
    const back = pivotFrame(long, { rowFields: ["city"], colFields: ["variable"], values: ["value"], funcs: ["sum"] });
    expect(back.columns.map((c) => c.name)).toEqual(["city", "jan", "feb"]);
    expect(back.columns[0].values).toEqual(["Oslo", "Bergen"]);
    expect(back.columns[1].values).toEqual([1, 3]); // jan
    expect(back.columns[2].values).toEqual([2, 4]); // feb
  });
  it("pivot aggregates collisions and nulls missing combinations", () => {
    const long: FrameValue = {
      __frame: true,
      columns: [
        { name: "k", type: "string", values: ["A", "A", "B"] },
        { name: "c", type: "string", values: ["x", "x", "y"] },
        { name: "v", type: "number", values: [5, 7, 2] },
      ],
    };
    const out = pivotFrame(long, { rowFields: ["k"], colFields: ["c"], values: ["v"], funcs: ["sum"] });
    expect(out.columns.map((c) => c.name)).toEqual(["k", "x", "y"]);
    expect(out.columns[1].values).toEqual([12, null]); // A.x = 5+7, B.x missing
    expect(out.columns[2].values).toEqual([null, 2]);  // A.y missing, B.y = 2
  });
});

describe("nest / unnest (flat ⟷ cube)", () => {
  const flat: FrameValue = {
    __frame: true,
    columns: [
      { name: "cust", type: "string", values: ["A", "A", "B"] },
      { name: "item", type: "string", values: ["x", "y", "z"] },
      { name: "qty", type: "number", values: [1, 2, 3] },
    ],
  };
  it("nest groups non-key columns into a nested-frame cell per key", () => {
    const cube = nestFrame(flat, ["cust"], "orders");
    expect(isCubeValue(cube)).toBe(true);
    expect(cube.columns.map((c) => c.name)).toEqual(["cust", "orders"]);
    expect(cube.columns[0].cells).toEqual(["A", "B"]);
    const firstNested = cube.columns[1].cells[0];
    expect(isFrameValue(firstNested)).toBe(true);
    if (!isFrameValue(firstNested)) throw new Error("nested cell should be a frame");
    expect(firstNested.columns.map((c) => c.name)).toEqual(["item", "qty"]);
    expect(firstNested.columns[0].values).toEqual(["x", "y"]);
  });
  it("nest carries the key column's TYPE (typed CubeColumn — a date key stays date-matchable)", () => {
    const cube = nestFrame(flat, ["cust"], "orders");
    expect(cube.columns[0].type).toBe("string");
  });
  it("unnest is the inverse: a depth-1 cube → flat recovers the rows", () => {
    const back = unnestCube(nestFrame(flat, ["cust"], "orders"), "orders");
    if (!isFrameValue(back)) throw new Error("depth-1 unnest should be a Frame");
    expect(back.columns.map((c) => c.name)).toEqual(["cust", "item", "qty"]);
    expect(back.columns[0].values).toEqual(["A", "A", "B"]);
    expect(back.columns[1].values).toEqual(["x", "y", "z"]);
    expect(back.columns[2].values).toEqual([1, 2, 3]);
  });
  it("unnest #REF!s on an unknown nested column", () => {
    let err: unknown;
    try { unnestCube(nestFrame(flat, ["cust"]), "nope"); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#REF!");
  });

  // B8.1: a depth-2 cube (nested cells are CUBES) peels ONE level to a depth-1 cube.
  const orders1: FrameValue = { __frame: true, columns: [{ name: "sku", type: "string", values: ["a", "b"] }] };
  const orders2: FrameValue = { __frame: true, columns: [{ name: "sku", type: "string", values: ["z"] }] };
  const repN = cubeFromColumns([{ name: "rep", cells: ["Ann"], type: "string" }, { name: "orders", cells: [orders1] }]);
  const repS = cubeFromColumns([{ name: "rep", cells: ["Cy"], type: "string" }, { name: "orders", cells: [orders2] }]);
  const depth2 = cubeFromColumns([{ name: "region", cells: ["N", "S"], type: "string" }, { name: "reps", cells: [repN, repS] }]);

  it("peels a depth-2 cube one level → a depth-1 cube, child column intact", () => {
    expect(cubeDepth(depth2)).toBe(2);
    const peeled = unnestCube(depth2, "reps");
    if (!isCubeValue(peeled)) throw new Error("a nested-cube column should peel to a Cube");
    expect(cubeDepth(peeled)).toBe(1);
    expect(peeled.columns.map((c) => c.name)).toEqual(["region", "rep", "orders"]);
    expect(peeled.columns[0].cells).toEqual(["N", "S"]);       // parent repeats per child row (1 each here)
    expect(peeled.columns[1].cells).toEqual(["Ann", "Cy"]);
    expect(isFrameValue(peeled.columns[2].cells[0])).toBe(true); // the child's own nested column stays nested
    expect(cubeRowCount(peeled)).toBe(2);
  });

  it("peel then Unnest again is the two-step inverse → the flat leaf rows", () => {
    const once = unnestCube(depth2, "reps");
    if (!isCubeValue(once)) throw new Error("first peel should be a Cube");
    const twice = unnestCube(once, "orders");
    if (!isFrameValue(twice)) throw new Error("second unnest should flatten to a Frame");
    expect(twice.columns.map((c) => c.name)).toEqual(["region", "rep", "sku"]);
    expect(twice.columns[0].values).toEqual(["N", "N", "S"]); // N repeats for orders1's two rows
    expect(twice.columns[1].values).toEqual(["Ann", "Ann", "Cy"]);
    expect(twice.columns[2].values).toEqual(["a", "b", "z"]);
  });

  it("a nested column mixing tables and cubes is a #TYPE!", () => {
    const mixed = cubeFromColumns([
      { name: "k", cells: ["a", "b"], type: "string" },
      { name: "nested", cells: [orders1, repN] }, // one frame, one cube
    ]);
    let err: unknown;
    try { unnestCube(mixed, "nested"); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#TYPE!");
  });
});

describe("pivotFrame — Excel PIVOTBY parity", () => {
  // region, product, qty, price
  const sales: FrameValue = {
    __frame: true,
    columns: [
      { name: "region", type: "string", values: ["East", "East", "East", "West", "West"] },
      { name: "product", type: "string", values: ["A", "A", "B", "A", "B"] },
      { name: "qty", type: "number", values: [10, 20, 5, 7, 8] },
      { name: "price", type: "number", values: [100, 200, 50, 70, 80] },
    ],
  };
  const col = (fr: FrameValue, name: string) => fr.columns.find((c) => c.name === name)?.values;

  it("rows × columns cross-tab aggregates per (rowGroup, colGroup)", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: ["product"], values: ["qty"], funcs: ["sum"] });
    expect(out.columns.map((c) => c.name)).toEqual(["region", "A", "B"]);
    expect(col(out, "region")).toEqual(["East", "West"]);
    expect(col(out, "A")).toEqual([30, 7]); // East A = 10+20, West A = 7
    expect(col(out, "B")).toEqual([5, 8]);
  });

  it("grand total RE-AGGREGATES the source (AVERAGE total ≠ average of cell averages)", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["avg"], rowTotalDepth: 1 });
    const qty = col(out, "qty") as number[];
    expect(qty[0]).toBeCloseTo(35 / 3); // East avg of 10,20,5
    expect(qty[1]).toBeCloseTo(7.5);    // West avg of 7,8
    expect(qty[2]).toBe(10);            // grand = 50/5, NOT (35/3 + 7.5)/2 ≈ 9.583
    expect(col(out, "region")![2]).toBe("Grand Total");
  });

  it("subtotals (depth 2) over two row fields, re-aggregated, bottom placement", () => {
    const out = pivotFrame(sales, { rowFields: ["region", "product"], colFields: [], values: ["qty"], funcs: ["sum"], rowTotalDepth: 2 });
    expect(col(out, "region")).toEqual(["East", "East", "East", "West", "West", "West", "Grand Total"]);
    expect(col(out, "product")).toEqual(["A", "B", "Total", "A", "B", "Total", null]);
    expect(col(out, "qty")).toEqual([30, 5, 35, 7, 8, 15, 50]);
  });

  it("negative depth places the grand total at the top", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["sum"], rowTotalDepth: -1 });
    expect(col(out, "region")).toEqual(["Grand Total", "East", "West"]);
    expect(col(out, "qty")).toEqual([50, 35, 15]);
  });

  it("subtotals at top (depth -2): grand then each group's subtotal above its rows", () => {
    const out = pivotFrame(sales, { rowFields: ["region", "product"], colFields: [], values: ["qty"], funcs: ["sum"], rowTotalDepth: -2 });
    expect(col(out, "region")).toEqual(["Grand Total", "East", "East", "East", "West", "West", "West"]);
    expect(col(out, "product")).toEqual([null, "Total", "A", "B", "Total", "A", "B"]);
    expect(col(out, "qty")).toEqual([50, 35, 30, 5, 15, 7, 8]);
  });

  it("per-value functions: one function per value column", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty", "price"], funcs: ["sum", "avg"] });
    expect(out.columns.map((c) => c.name)).toEqual(["region", "qty", "price"]);
    expect(col(out, "qty")).toEqual([35, 15]);
    expect((col(out, "price") as number[])[0]).toBeCloseTo(350 / 3);
    expect((col(out, "price") as number[])[1]).toBeCloseTo(75);
  });

  it("a grand total COLUMN re-aggregates across column groups", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: ["product"], values: ["qty"], funcs: ["sum"], colTotalDepth: 1 });
    expect(out.columns.map((c) => c.name)).toEqual(["region", "A", "B", "Grand Total"]);
    expect(col(out, "Grand Total")).toEqual([35, 15]); // East 30+5, West 7+8
  });

  it("value-based sort orders groups by the measure (Excel 'sort by sales')", () => {
    // ascending by qty (index = rowFields(1) + values(1) = 2): West(15) before East(35)
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["sum"], rowSort: 2 });
    expect(col(out, "region")).toEqual(["West", "East"]);
    expect(col(out, "qty")).toEqual([15, 35]);
  });

  it("field-based sort orders a header level descending", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["sum"], rowSort: -1 });
    expect(col(out, "region")).toEqual(["West", "East"]); // West > East descending
  });

  it("filter_array masks source rows before aggregating", () => {
    // keep only rows 0,1,2 (the East rows)
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["sum"], filter: [true, true, true, false, false] });
    expect(col(out, "region")).toEqual(["East"]);
    expect(col(out, "qty")).toEqual([35]);
  });

  it("PERCENTOF — % of column total (relativeTo 0)", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["percentof"], relativeTo: 0 });
    const qty = col(out, "qty") as number[];
    expect(qty[0]).toBeCloseTo(35 / 50); // East share of the single column's total
    expect(qty[1]).toBeCloseTo(15 / 50);
  });

  it("expanded function set: median, product, stdevp", () => {
    const m = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["median"] });
    expect(col(m, "qty")).toEqual([10, 7.5]); // East median(10,20,5)=10, West median(7,8)=7.5
    const p = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["product"] });
    expect(col(p, "qty")).toEqual([1000, 56]); // East 10*20*5, West 7*8
    const s = pivotFrame(sales, { rowFields: ["region"], colFields: [], values: ["qty"], funcs: ["stdevp"] });
    expect((col(s, "qty") as number[])[1]).toBeCloseTo(0.5); // pop stdev of 7,8
  });

  it("multi-level column headers flatten to composite names", () => {
    const out = pivotFrame(sales, { rowFields: ["region"], colFields: ["product"], values: ["qty", "price"], funcs: ["sum", "sum"] });
    // colGroup × value → "A | qty", "A | price", "B | qty", "B | price"
    expect(out.columns.map((c) => c.name)).toEqual(["region", "A | qty", "A | price", "B | qty", "B | price"]);
    expect(col(out, "A | qty")).toEqual([30, 7]);
    expect(col(out, "A | price")).toEqual([300, 70]);
  });
});

describe("splitColumn / addIndexColumn (Power Query column ops)", () => {
  const f: FrameValue = {
    __frame: true,
    columns: [
      { name: "id", type: "number", values: [1, 2, 3] },
      { name: "name", type: "string", values: ["Ada Lovelace", "Bo", "Cy De Morgan"] },
    ],
  };
  const col = (fr: FrameValue, name: string) => fr.columns.find((c) => c.name === name)?.values;

  it("split replaces the column in place with N parts, padding short rows", () => {
    const out = splitColumn(f, "name", " ");
    expect(out.columns.map((c) => c.name)).toEqual(["id", "name 1", "name 2", "name 3"]);
    expect(col(out, "name 1")).toEqual(["Ada", "Bo", "Cy"]);
    expect(col(out, "name 2")).toEqual(["Lovelace", null, "De"]); // Bo has no 2nd part
    expect(col(out, "name 3")).toEqual([null, null, "Morgan"]);
  });

  it("split honors explicit names and keeps column order", () => {
    const out = splitColumn(f, "name", " ", ["first", "rest"]);
    // only 2 names given but max parts is 3 → third auto-numbers
    expect(out.columns.map((c) => c.name)).toEqual(["id", "first", "rest", "name 3"]);
    expect(col(out, "first")).toEqual(["Ada", "Bo", "Cy"]);
  });

  it("split on an empty delimiter is a no-op", () => {
    expect(splitColumn(f, "name", "")).toBe(f);
  });

  it("addIndex prepends a 1-based row-number column by default", () => {
    const out = addIndexColumn(f, "Index", 1);
    expect(out.columns.map((c) => c.name)).toEqual(["Index", "id", "name"]);
    expect(col(out, "Index")).toEqual([1, 2, 3]);
  });

  it("addIndex honors a custom start and de-dupes a colliding name", () => {
    const out = addIndexColumn(f, "id", 100); // collides with existing "id"
    expect(out.columns[0].values).toEqual([100, 101, 102]);
    expect(out.columns.map((c) => c.name)).not.toEqual(["id", "id", "name"]); // de-duped
  });
});

describe("NaN poisons aggregates loudly (B-1b — supersedes audit finding 31)", () => {
  // NaN is PRESENT-but-dirty. Count/filter/sort semantics are corpus-pinned
  // (__nf cases); the #DOMAIN! poison is a SolError CELL, so oracle-only.
  it("sum over a NaN cell → #DOMAIN!, never a quiet NaN", () => {
    const g = groupByFrame(
      { __frame: true, columns: [
        { name: "k", type: "string", values: ["a", "a", "a"] },
        { name: "v", type: "number", values: [1, NaN, 3] },
      ] },
      ["k"],
      [{ column: "v", op: "sum", as: "s" }],
    );
    const sum = g.columns[1].values[0];
    expect(isSolError(sum) && sum.code).toBe("#DOMAIN!");
  });
});

// ─── Timesaver cleanup verbs (2026-07-16) ───────────────────────────────────────

describe("timesaver verbs", () => {
  const gaps: FrameValue = {
    __frame: true,
    columns: [
      { name: "region", type: "string", values: ["North", null, null, "South", null] },
      { name: "sales", type: "number", values: [1, 2, null, 4, 5] },
    ],
  };

  it("fillBlanks down un-merges report-shaped columns; up carries backward", () => {
    const down = fillBlanks(gaps, ["region"], "down");
    expect(down.columns[0].values).toEqual(["North", "North", "North", "South", "South"]);
    expect(down.columns[1].values).toEqual([1, 2, null, 4, 5]); // untouched: not named
    const up = fillBlanks(gaps, [], "up"); // blank columns list = all
    expect(up.columns[0].values).toEqual(["North", "South", "South", "South", null]);
    expect(up.columns[1].values).toEqual([1, 2, 4, 4, 5]);
  });

  it("fillBlanks treats errors as values (they neither fill nor get overwritten)", () => {
    const withErr: FrameValue = {
      __frame: true,
      columns: [{ name: "a", type: "number", values: [1, solError("#DIV/0!", "x"), null] }],
    };
    const out = fillBlanks(withErr, [], "down");
    expect(isSolError(out.columns[0].values[1])).toBe(true);
    expect(isSolError(out.columns[0].values[2])).toBe(true); // the error carried into the blank
  });

  it("replaceValues: whole-cell matches numbers numerically, coerces to column type", () => {
    const out = replaceValues(f, "qty", "20", "99", "cell");
    expect(out.columns[2].values).toEqual([10, 99, 30]);
    // Column blank = all columns; string column matched textually.
    const all = replaceValues(f, "", "b", "z", "cell");
    expect(all.columns[1].values).toEqual(["a", "z", "c"]);
    // Case-sensitive: "B" doesn't hit "b".
    expect(replaceValues(f, "", "B", "z", "cell").columns[1].values).toEqual(["a", "b", "c"]);
  });

  it("replaceValues: substring rewrites inside text cells only", () => {
    const t: FrameValue = {
      __frame: true,
      columns: [
        { name: "s", type: "string", values: ["north-east", "north-west", null] },
        { name: "n", type: "number", values: [101, 102, 103] },
      ],
    };
    const out = replaceValues(t, "", "north", "N", "substring");
    expect(out.columns[0].values).toEqual(["N-east", "N-west", null]);
    expect(out.columns[1].values).toEqual([101, 102, 103]); // numbers untouched in substring mode
  });

  it("mergeColumns joins formatted cells, drops sources, sits at the first source's slot", () => {
    const out = mergeColumns(f, ["name", "qty"], " · ", "Tag");
    expect(out.columns.map((c) => c.name)).toEqual(["id", "Tag"]);
    expect(out.columns[1].type).toBe("string");
    expect(out.columns[1].values).toEqual(["a · 10", "b · 20", "c · 30"]);
    let err: unknown;
    try { mergeColumns(f, ["name"], ",", ""); } catch (e) { err = e; }
    expect(isSolError(err)).toBe(true);
  });

  it("promoteHeaders lifts row 1 into names (uniquified); demoteHeaders is its inverse shape", () => {
    const raw: FrameValue = {
      __frame: true,
      columns: [
        { name: "Col1", type: "string", values: ["Region", "North", "South"] },
        { name: "Col2", type: "string", values: ["Sales", "1", "2"] },
      ],
    };
    const up = promoteHeaders(raw);
    expect(up.columns.map((c) => c.name)).toEqual(["Region", "Sales"]);
    expect(up.columns[0].values).toEqual(["North", "South"]);
    const down = demoteHeaders(up);
    expect(down.columns.map((c) => c.name)).toEqual(["Col1", "Col2"]);
    expect(down.columns[0].values).toEqual(["Region", "North", "South"]);
    expect(down.columns.every((c) => c.type === "string")).toBe(true);
  });

  it("dropBlankRows: 'all' drops spacers only, 'any' keeps complete rows", () => {
    const t: FrameValue = {
      __frame: true,
      columns: [
        { name: "a", type: "number", values: [1, null, null, 4] },
        { name: "b", type: "string", values: ["x", null, "y", "z"] },
      ],
    };
    expect(dropBlankRows(t, "all").columns[0].values).toEqual([1, null, 4]);
    expect(dropBlankRows(t, "any").columns[0].values).toEqual([1, 4]);
  });

  it("sliceRows covers last / skip / 1-based inclusive range", () => {
    expect(sliceRows(f, "last", 2).columns[0].values).toEqual([2, 3]);
    expect(sliceRows(f, "skip", 1).columns[0].values).toEqual([2, 3]);
    expect(sliceRows(f, "range", 2, 3).columns[0].values).toEqual([2, 3]);
    expect(sliceRows(f, "range", 3, 2).columns[0].values).toEqual([]); // inverted → empty
    expect(sliceRows(f, "first", 99).columns[0].values).toEqual([1, 2, 3]);
  });

});
