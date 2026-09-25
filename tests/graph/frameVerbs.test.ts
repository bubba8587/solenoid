// [[C16]] polarsEngine, [[D49]]
import { describe, it, expect } from "vitest";
import { sortByColumn, distinctRows, filterRows, filterRowsMulti, groupByFrame, unpivotFrame, pivotFrame, nestFrame, unnestCube, splitColumn, addIndexColumn, fillBlanks, replaceValues, mergeColumns, promoteHeaders, demoteHeaders, dropBlankRows, sliceRows } from "../../src/graph/frameVerbs";
import { isSolError, solError } from "../../src/graph/errorValue";
import { isCubeValue, isFrameValue, cubeFromColumns, cubeDepth, cubeRowCount, type FrameValue } from "../../src/graph/frame";

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
});

describe("distinct — the cross-backend key contract (B-1a, re-cut 2026-08-22)", () => {
  it("+∞, −∞ and NaN key apart from each other and from null", () => {
    const nf: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [Infinity, -Infinity, NaN, null, Infinity, NaN, null, 1] }],
    };
    expect(distinctRows(nf).columns[0].values).toEqual([Infinity, -Infinity, NaN, null, 1]);
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
});

// [[D76]] textMinMax
describe("text min and max", () => {
  const t: FrameValue = {
    __frame: true,
    columns: [
      { name: "k", type: "string", values: ["a", "a", "a", "b"] },
      { name: "s", type: "string", values: ["pear", "Plum", null, solError("#N/A", "x")] },
    ],
  };
  it("GROUPBY returns the code-unit first and last as text; an error cell wins", () => {
    const out = groupByFrame(t, ["k"], [{ column: "s", op: "min", as: "lo" }, { column: "s", op: "max", as: "hi" }]);
    const err = out.columns[1].values[1];
    expect(isSolError(err) && err.code).toBe("#N/A");
  });
  it("PIVOTBY (GROUPBY with totals) agrees and types the body column as text", () => {
    const out = pivotFrame(t, { rowFields: ["k"], colFields: [], values: ["s"], funcs: ["max"], rowTotalDepth: 1 });
    const body = out.columns[1];
    expect(body.type).toBe("string");
    expect(body.values[0]).toBe("pear");
    expect(isSolError(body.values[2])).toBe(true);
  });
});

describe("unpivot / pivot (reshape)", () => {
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
    expect(cube.columns.map((c) => c.name)).toEqual(["cust", "orders"]);
    expect(cube.columns[0].cells).toEqual(["A", "B"]);
    const firstNested = cube.columns[1].cells[0];
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

  it("a LIST column explodes to one row per element, keeping the column name; an empty list keeps a blank row", () => {
    const c = cubeFromColumns([
      { name: "Task", cells: ["Drywall", "Paint", "Demolition"], type: "string" },
      { name: "Predecessors", cells: [["Plumbing", "Electrical"], ["Drywall"], []] },
    ]);
    const out = unnestCube(c, "Predecessors");
    if (!isFrameValue(out)) throw new Error("expected a frame");
    expect(out.columns.map((col) => col.name)).toEqual(["Task", "Predecessors"]);
    expect(out.columns[0].values).toEqual(["Drywall", "Drywall", "Paint", "Demolition"]);
    expect(out.columns[1].values).toEqual(["Plumbing", "Electrical", "Drywall", null]); // empty list → one blank row
  });

  it("a nested column mixing lists and tables is a #TYPE!", () => {
    const mixed = cubeFromColumns([
      { name: "k", cells: ["a", "b"], type: "string" },
      { name: "nested", cells: [["x"], orders1] }, // one list, one frame
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
  });
});

// ─── Timesaver cleanup verbs (2026-07-16) ───────────────────────────────────────

describe("timesaver verbs", () => {
  it("replaceValues: the shared match rule (parity with Rust lazy_replace_values)", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "n", type: "number", values: [5, 20, null] },
        { name: "flag", type: "logical", values: [true, false, true] },
      ],
    };
    // Number: numeric equality against the parsed find — "5.0" and "5" both hit 5;
    // a non-numeric find hits no number cell.
    expect(replaceValues(g, "n", "5.0", "99", "cell").columns[0].values).toEqual([99, 20, null]);
    expect(replaceValues(g, "n", "five", "99", "cell").columns[0].values).toEqual([5, 20, null]);
    // Boolean: "1"/"0" never match a boolean.
    expect(replaceValues(g, "flag", "1", "false", "cell").columns[1].values).toEqual([true, false, true]);
  });

  it("replaceValues drops a rewritten column's source text, so the popup shows the new cell", () => {
    const t: FrameValue = { __frame: true, columns: [{ name: "n", type: "number", values: [5, 6], raw: ["5", "6"] }] };
    expect(replaceValues(t, "n", "5", "9", "cell").columns[0].raw).toBeUndefined();
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
    expect(sliceRows(f, "first", 99).columns[0].values).toEqual([1, 2, 3]);
  });

  it("row and value verbs drop the source text, which would no longer line up", () => {
    const src: FrameValue = { __frame: true, columns: [{ name: "a", type: "number", values: [1, null, 3], raw: ["1", "", "3"] }] };
    expect(sliceRows(src, "last", 2).columns[0].raw).toBeUndefined();
    expect(dropBlankRows(src, "any").columns[0].raw).toBeUndefined();
    expect(fillBlanks(src, ["a"], "down").columns[0].raw).toBeUndefined();
  });

});

describe("[[D49]] textPredicateNeedsText — a text predicate reads a TEXT column, or errors", () => {
  const grab = (fn: () => unknown) => {
    try { fn(); } catch (e) { return e as { code?: string; message?: string }; }
    return null;
  };
  it("[[D49]] textPredicateNeedsText: a text predicate on a non-string column is #TYPE!", () => {
    for (const op of ["contains", "startsWith", "endsWith"] as const) {
      const err = grab(() => filterRows(f, "qty", op, "0"));
      expect(isSolError(err)).toBe(true);
      expect(err!.code).toBe("#TYPE!");
    }
    // The message names the fix (Computed Column with TEXT, or Cast).
    const err = grab(() => filterRows(f, "qty", "contains", "0"));
    expect(err!.message).toContain('TEXT(@qty, "@")');
    expect(err!.message).toContain("Cast");
  });
  it("multi-condition: one text predicate on a number column fails the whole filter, even under OR", () => {
    const err = grab(() => filterRowsMulti(f, "or", [
      { column: "name", op: "eq", value: "a" },
      { column: "qty", op: "contains", value: "2" },
    ]));
    expect(isSolError(err)).toBe(true);
    expect(err!.code).toBe("#TYPE!");
  });
});

describe("unnestCube: an empty [] beside tables", () => {
  it("is an empty nested value, not a list vote", () => {
    const kids = cubeFromColumns([{ name: "k", cells: [1, 2], type: "number" }]);
    const c = cubeFromColumns([{ name: "p", cells: ["a", "b"], type: "string" }, { name: "kids", cells: [kids, []] }]);
    const out = unnestCube(c, "kids");
    expect(isCubeValue(out) && out.columns.find((x) => x.name === "p")!.cells).toEqual(["a", "a"]); // no children, no rows (like null)
  });
});

describe("replaceValues: a non-numeric replacement never writes NaN", () => {
  it("leaves a number column alone when the replacement is text; the string column still replaces", () => {
    const f: FrameValue = { __frame: true, columns: [
      { name: "s", type: "string", values: ["1", "1.0", "a"] },
      { name: "n", type: "number", values: [1, 1.5, 2] },
    ] };
    const out = replaceValues(f, "", "1", "Z", "cell");
    expect(out.columns[0].values).toEqual(["Z", "1.0", "a"]);
    expect(out.columns[1].values).toEqual([1, 1.5, 2]);
  });
});

describe("column units ride the reshaping verbs (unitFlow, review pins)", () => {
  const km = { dim: { length: 1 }, display: "km" };
  const src = (): FrameValue => ({ __frame: true, columns: [
    { name: "Region", type: "string", values: ["N", "N", "S"] },
    { name: "Dist", type: "number", unit: km, values: [1000, 2000, 500] },
  ] });
  it("GROUPBY keeps the key's and a sum/avg/min/max's unit, never a count's", () => {
    const out = groupByFrame(src(), ["Region"], [
      { column: "Dist", op: "sum", as: "Total" }, { column: "Dist", op: "count", as: "N" },
    ]);
    expect(out.columns.find((c) => c.name === "Total")!.unit).toEqual(km);
    expect(out.columns.find((c) => c.name === "N")!.unit).toBeUndefined();
  });
  it("PIVOTBY body keeps the value column's unit for a sum", () => {
    const out = pivotFrame(src(), { rowFields: ["Region"], colFields: [], values: ["Dist"], funcs: ["sum"] } as never);
    const body = out.columns.find((c) => c.name !== "Region")!;
    expect(body.unit).toEqual(km);
  });
  it("UNPIVOT keeps an id column's unit and a shared value unit", () => {
    const wide: FrameValue = { __frame: true, columns: [
      { name: "Region", type: "string", values: ["N"] },
      { name: "A", type: "number", unit: km, values: [1] },
      { name: "B", type: "number", unit: km, values: [2] },
    ] };
    const out = unpivotFrame(wide, ["Region"], ["A", "B"]);
    expect(out.columns[2].unit).toEqual(km);
  });
  it("Window keeps the unit on a running sum, not on a rank", async () => {
    const { windowFrame } = await import("../../src/graph/frameVerbs");
    const sum = windowFrame(src(), { partitionBy: [], fn: "cumsum", column: "Dist", as: "Run" });
    expect(sum.columns.find((c) => c.name === "Run")!.unit).toEqual(km);
    const rank = windowFrame(src(), { partitionBy: [], orderBy: "Dist", fn: "rank", as: "R" });
    expect(rank.columns.find((c) => c.name === "R")!.unit).toBeUndefined();
  });
});
