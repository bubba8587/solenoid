import { describe, it, expect } from "vitest";
import { selectColumns, dropColumns, renameColumns, sortByColumn, distinctRows, headRows, filterRows, filterRowsMulti, groupByFrame, joinFrames, appendFrames, unpivotFrame, pivotFrame, nestFrame, unnestCube, applyVerb, splitColumn, addIndexColumn, lookupFrameCell } from "./frameVerbs";
import { isSolError, solError } from "./errorValue";
import { isCubeValue, isFrameValue, type FrameValue } from "./frame";

const f: FrameValue = {
  __frame: true,
  columns: [
    { name: "id", type: "number", values: [1, 2, 3] },
    { name: "name", type: "string", values: ["a", "b", "c"] },
    { name: "qty", type: "number", values: [10, 20, 30] },
  ],
};

describe("select", () => {
  it("keeps the named columns in the requested order", () => {
    const out = selectColumns(f, ["qty", "id"]);
    expect(out.columns.map((c) => c.name)).toEqual(["qty", "id"]);
    expect(out.columns[0].values).toEqual([10, 20, 30]);
  });

  it("#REF!s on a missing column", () => {
    let err: unknown;
    try { selectColumns(f, ["nope"]); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#REF!");
  });

  it("does not mutate the input frame", () => {
    selectColumns(f, ["id"]);
    expect(f.columns.map((c) => c.name)).toEqual(["id", "name", "qty"]);
  });
});

describe("drop", () => {
  it("removes the named columns", () => {
    expect(dropColumns(f, ["name"]).columns.map((c) => c.name)).toEqual(["id", "qty"]);
  });
  it("ignores a name that isn't present", () => {
    expect(dropColumns(f, ["ghost"]).columns.map((c) => c.name)).toEqual(["id", "name", "qty"]);
  });
});

describe("rename", () => {
  it("renames via the map, leaving others untouched", () => {
    const out = renameColumns(f, { id: "ID", qty: "quantity" });
    expect(out.columns.map((c) => c.name)).toEqual(["ID", "name", "quantity"]);
    expect(out.columns[0].values).toEqual([1, 2, 3]); // values preserved
  });
  it("de-duplicates a rename that collides with an existing name", () => {
    const out = renameColumns(f, { qty: "name" }); // would collide with "name"
    expect(out.columns.map((c) => c.name)).toEqual(["id", "name", "name2"]);
  });
});

describe("sort", () => {
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
  it("sorts a string column by locale", () => {
    expect(sortByColumn(s, "tag", "asc").columns[1].values).toEqual(["a", "b", "c", "e", "z"]);
  });
});

describe("distinct", () => {
  const d: FrameValue = {
    __frame: true,
    columns: [
      { name: "g", type: "string", values: ["x", "x", "y", "x"] },
      { name: "v", type: "number", values: [1, 1, 1, 2] },
    ],
  };
  it("dedupes whole rows, keeping first occurrence", () => {
    const out = distinctRows(d);
    expect(out.columns[0].values).toEqual(["x", "y", "x"]);
    expect(out.columns[1].values).toEqual([1, 1, 2]);
  });
  it("dedupes on a column subset", () => {
    expect(distinctRows(d, ["g"]).columns[0].values).toEqual(["x", "y"]);
  });
  it("distinguishes types in the key (number 1 vs string '1')", () => {
    const mixed: FrameValue = {
      __frame: true,
      columns: [{ name: "a", type: "string", values: ["1"] }, { name: "b", type: "number", values: [1] }],
    };
    expect(distinctRows(mixed).columns[0].values).toEqual(["1"]); // one row, not collapsed away
  });

  // ── The cross-backend key contract (B-1a, 2026-07-05) ──────────────────────
  // Rust keys rows with serde_json of the SAME tagged tuples this oracle builds,
  // asserted byte-identical in engine/tests.rs `row_key_is_byte_identical_to_js_
  // json_stringify` against this exact literal. If encodeCell's encoding ever
  // changes, update BOTH pins together.
  it("the tagged-tuple key literal both backends pin (incl. \\u0001 + -0)", () => {
    const literal = JSON.stringify([["s", "a\u0001b"], ["#", 1], ["#", -0], ["b", true], ["n"]]);
    expect(literal).toBe('[["s","a\\u0001b"],["#",1],["#",0],["b",true],["n"]]');
  });
  it("ALL non-finite numbers share one key bucket (JSON.stringify(Infinity) is null)", () => {
    // Pinned as the cross-backend contract: Rust's key_num mirrors this null
    // bucket exactly (engine/tests.rs). ∞, −∞ and NaN dedupe together.
    const nf: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [Infinity, -Infinity, NaN, 1] }],
    };
    const out = distinctRows(nf);
    expect(out.columns[0].values.length).toBe(2); // one non-finite bucket + 1
  });
  it("crafted separator strings never collide (the old Rust \\u{1}-join bug class)", () => {
    const crafted: FrameValue = {
      __frame: true,
      columns: [
        { name: "a", type: "string", values: ["x\u0001s:y", "x"] },
        { name: "b", type: "string", values: ["z", "y\u0001s:z"] },
      ],
    };
    expect(distinctRows(crafted).columns[0].values).toEqual(["x\u0001s:y", "x"]); // both rows survive
  });
});

describe("head", () => {
  it("takes the first n rows", () => {
    expect(headRows(f, 2).columns[0].values).toEqual([1, 2]);
  });
  it("clamps n to [0, rowCount]", () => {
    expect(headRows(f, 0).columns[0].values).toEqual([]);
    expect(headRows(f, 99).columns[0].values).toEqual([1, 2, 3]);
    expect(headRows(f, -5).columns[0].values).toEqual([]);
  });
});

describe("filter", () => {
  const t: FrameValue = {
    __frame: true,
    columns: [
      { name: "qty", type: "number", values: [5, 12, null, 20, solError("#DIV/0!", "x")] },
      { name: "city", type: "string", values: ["Oslo", "Bergen", "Oslo", "Tromso", "Oslo"] },
    ],
  };
  it("keeps numeric rows passing the comparison; blanks + errors drop", () => {
    const out = filterRows(t, "qty", "gte", 12);
    expect(out.columns[0].values).toEqual([12, 20]);
    expect(out.columns[1].values).toEqual(["Bergen", "Tromso"]);
  });
  it("filters a string column by equality and by contains", () => {
    expect(filterRows(t, "city", "eq", "Oslo").columns[0].values).toEqual([5, null, solError("#DIV/0!", "x")]);
    expect(filterRows(t, "city", "contains", "o").columns[1].values).toEqual(["Oslo", "Oslo", "Tromso", "Oslo"]);
  });
  it("chains for AND (qty>=10 AND city=Oslo)", () => {
    const out = filterRows(filterRows(t, "qty", "gte", 10), "city", "eq", "Oslo");
    expect(out.columns[0].values).toEqual([]); // the one Oslo with qty>=10 is the error row, excluded
  });
  it("#REF!s on an unknown column", () => {
    let err: unknown;
    try { filterRows(t, "nope", "eq", 1); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#REF!");
  });
  it("matches text case-insensitively by default; matchCase restores exact", () => {
    expect(filterRows(t, "city", "eq", "oslo").columns[1].values).toEqual(["Oslo", "Oslo", "Oslo"]);
    expect(filterRows(t, "city", "eq", "oslo", true).columns[1].values).toEqual([]);
    expect(filterRows(t, "city", "contains", "OS").columns[1].values).toEqual(["Oslo", "Oslo", "Oslo"]);
    expect(filterRows(t, "city", "contains", "OS", true).columns[1].values).toEqual([]);
    expect(filterRows(t, "city", "startsWith", "tr").columns[1].values).toEqual(["Tromso"]);
    expect(filterRows(t, "city", "neq", "oslo").columns[1].values).toEqual(["Bergen", "Tromso"]);
    expect(filterRows(t, "city", "neq", "oslo", true).columns[1].values).toEqual(["Oslo", "Bergen", "Oslo", "Tromso", "Oslo"]);
  });
  it("folds accented characters (José = JOSÉ), matchCase separates them", () => {
    const names: FrameValue = {
      __frame: true,
      columns: [{ name: "n", type: "string", values: ["José", "JOSÉ", "Jose"] }],
    };
    expect(filterRows(names, "n", "eq", "josé").columns[0].values).toEqual(["José", "JOSÉ"]);
    expect(filterRows(names, "n", "eq", "josé", true).columns[0].values).toEqual([]);
    expect(filterRows(names, "n", "endsWith", "SÉ").columns[0].values).toEqual(["José", "JOSÉ"]);
  });
  it("applyVerb forwards the matchCase flag", () => {
    expect(applyVerb(t, { kind: "filter", column: "city", op: "eq", value: "OSLO" }).columns[1].values).toEqual(["Oslo", "Oslo", "Oslo"]);
    expect(applyVerb(t, { kind: "filter", column: "city", op: "eq", value: "OSLO", matchCase: true }).columns[1].values).toEqual([]);
  });
});

describe("filterMulti — AND/OR condition rows (B-2)", () => {
  const t: FrameValue = {
    __frame: true,
    columns: [
      { name: "qty", type: "number", values: [5, 12, null, 20, solError("#DIV/0!", "x")] },
      { name: "city", type: "string", values: ["Oslo", "Bergen", "Oslo", "Tromso", "Oslo"] },
    ],
  };
  it("AND keeps rows passing every condition (single-pass ≡ chained filters)", () => {
    const out = filterRowsMulti(t, "and", [
      { column: "qty", op: "gte", value: 10 },
      { column: "city", op: "eq", value: "oslo" },
    ]);
    expect(out.columns[0].values).toEqual([]); // the only qty≥10 Oslo row is the error row
    const chained = filterRows(filterRows(t, "qty", "gte", 10), "city", "eq", "oslo");
    expect(out.columns[1].values).toEqual(chained.columns[1].values);
  });
  it("OR keeps rows passing ANY condition — the thing a filter chain can't say", () => {
    const out = filterRowsMulti(t, "or", [
      { column: "qty", op: "gte", value: 15 },
      { column: "city", op: "eq", value: "bergen" },
    ]);
    expect(out.columns[1].values).toEqual(["Bergen", "Tromso"]);
    expect(out.columns[0].values).toEqual([12, 20]);
  });
  it("matchCase rides per-condition", () => {
    const out = filterRowsMulti(t, "or", [
      { column: "city", op: "eq", value: "bergen", matchCase: true },  // exact: no match
      { column: "city", op: "startsWith", value: "tr" },               // folded: Tromso
    ]);
    expect(out.columns[1].values).toEqual(["Tromso"]);
  });
  it("a null/error cell fails ITS condition only — OR can still keep the row", () => {
    const out = filterRowsMulti(t, "or", [
      { column: "qty", op: "gte", value: 0 },       // null + error rows fail here
      { column: "city", op: "eq", value: "oslo" },  // …but two of them are Oslo
    ]);
    expect(out.columns[1].values).toEqual(["Oslo", "Bergen", "Oslo", "Tromso", "Oslo"]);
  });
  it("an unparseable value matches no rows for that condition; OR survives, AND empties", () => {
    expect(filterRowsMulti(t, "or", [
      { column: "qty", op: "gt", value: "garbage" },
      { column: "city", op: "eq", value: "bergen" },
    ]).columns[1].values).toEqual(["Bergen"]);
    expect(filterRowsMulti(t, "and", [
      { column: "qty", op: "gt", value: "garbage" },
      { column: "city", op: "eq", value: "bergen" },
    ]).columns[1].values).toEqual([]);
  });
  it("no conditions = identity (NOT OR's vacuous false)", () => {
    expect(filterRowsMulti(t, "or", []).columns[1].values).toEqual(t.columns[1].values);
    expect(filterRowsMulti(t, "and", []).columns[1].values).toEqual(t.columns[1].values);
  });
  it("#REF!s on an unknown column in any condition", () => {
    let err: unknown;
    try {
      filterRowsMulti(t, "and", [{ column: "qty", op: "gte", value: 1 }, { column: "nope", op: "eq", value: 1 }]);
    } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#REF!");
  });
  it("applyVerb routes the op", () => {
    const out = applyVerb(t, {
      kind: "filterMulti", combine: "or",
      conditions: [{ column: "qty", op: "gte", value: 15 }, { column: "city", op: "eq", value: "bergen" }],
    });
    expect(out.columns[1].values).toEqual(["Bergen", "Tromso"]);
  });

  it("complement is the exhaustive ROW complement (null/error rows land in Dropped)", () => {
    // Kept for qty≥10: rows 12, 20. Dropped: 5, the null row, the error row —
    // the cargo twin is filter_multi_complement_is_the_exhaustive_row_complement.
    const conditions = [{ column: "qty", op: "gte" as const, value: 15 }];
    const kept = filterRowsMulti(t, "and", conditions);
    const dropped = filterRowsMulti(t, "and", conditions, true);
    expect(kept.columns[0].values.length + dropped.columns[0].values.length)
      .toBe(t.columns[0].values.length);
    expect(dropped.columns[1].values).toEqual(["Oslo", "Bergen", "Oslo", "Oslo"]);
    // Complement of the no-conditions identity = the empty frame, same schema.
    const empty = filterRowsMulti(t, "and", [], true);
    expect(empty.columns.map((c) => c.name)).toEqual(["qty", "city"]);
    expect(empty.columns[0].values).toEqual([]);
  });
});

describe("groupBy", () => {
  const g: FrameValue = {
    __frame: true,
    columns: [
      { name: "city", type: "string", values: ["Oslo", "Bergen", "Oslo", "Oslo", "Bergen"] },
      { name: "amt", type: "number", values: [10, 5, 20, null, solError("#DIV/0!", "x")] },
    ],
  };
  it("aggregates per group: sum skips null, count is present cells, first-seen order", () => {
    const out = groupByFrame(g, ["city"], [
      { column: "amt", op: "sum", as: "total" },
      { column: "amt", op: "count", as: "n" },
    ]);
    expect(out.columns.map((c) => c.name)).toEqual(["city", "total", "n"]);
    expect(out.columns[0].values).toEqual(["Oslo", "Bergen"]);
    expect(out.columns[1].values[0]).toBe(30);             // 10 + 20 (null skipped)
    expect(isSolError(out.columns[1].values[1])).toBe(true); // 5 + error → error propagates
    expect(out.columns[2].values).toEqual([2, 2]);          // present (non-null) cells per group
  });
  it("avg skips null and propagates error", () => {
    const out = groupByFrame(g, ["city"], [{ column: "amt", op: "avg", as: "mean" }]);
    expect(out.columns[1].values[0]).toBe(15);              // (10+20)/2
    expect(isSolError(out.columns[1].values[1])).toBe(true);
  });
  // ── The aggregate non-finite guard (B-1b, decided 2026-07-02) ───────────────
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
  it("SUM of ∞ IS ∞ — an infinite input passes through", () => {
    const inf: FrameValue = {
      __frame: true,
      columns: [
        { name: "g", type: "string", values: ["a", "a"] },
        { name: "v", type: "number", values: [Infinity, 5] },
      ],
    };
    const out = groupByFrame(inf, ["g"], [{ column: "v", op: "sum", as: "t" }]);
    expect(out.columns[1].values[0]).toBe(Infinity);
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
  it("min/max preserve the source column type (date stays date, not a bare serial)", () => {
    const d: FrameValue = {
      __frame: true,
      columns: [
        { name: "g", type: "string", values: ["a", "a"] },
        { name: "when", type: "date", values: [46000, 46010] },
      ],
    };
    const out = groupByFrame(d, ["g"], [{ column: "when", op: "max", as: "latest" }]);
    expect(out.columns[1].type).toBe("date");
    expect(out.columns[1].values).toEqual([46010]);
  });
  it("groups on a multi-column key", () => {
    const m: FrameValue = {
      __frame: true,
      columns: [
        { name: "a", type: "string", values: ["x", "x", "y"] },
        { name: "b", type: "number", values: [1, 1, 1] },
        { name: "v", type: "number", values: [2, 3, 4] },
      ],
    };
    const out = groupByFrame(m, ["a", "b"], [{ column: "v", op: "sum", as: "s" }]);
    expect(out.columns[0].values).toEqual(["x", "y"]);
    expect(out.columns[2].values).toEqual([5, 4]);
  });
});

describe("join", () => {
  const customers: FrameValue = {
    __frame: true,
    columns: [
      { name: "id", type: "number", values: [1, 2, 3] },
      { name: "name", type: "string", values: ["A", "B", "C"] },
    ],
  };
  const orders: FrameValue = {
    __frame: true,
    columns: [
      { name: "cust", type: "number", values: [1, 1, 3, 4] },
      { name: "amt", type: "number", values: [10, 20, 30, 40] },
    ],
  };
  const opts = (how: "inner" | "left" | "right" | "outer") => ({ leftKey: "id", rightKey: "cust", how });

  it("inner: only matches, fan-out, right key column dropped", () => {
    const out = joinFrames(customers, orders, opts("inner"));
    expect(out.columns.map((c) => c.name)).toEqual(["id", "name", "amt"]);
    expect(out.columns[0].values).toEqual([1, 1, 3]);
    expect(out.columns[1].values).toEqual(["A", "A", "C"]);
    expect(out.columns[2].values).toEqual([10, 20, 30]);
  });
  it("left: unmatched left row keeps null on the right side", () => {
    const out = joinFrames(customers, orders, opts("left"));
    expect(out.columns[0].values).toEqual([1, 1, 2, 3]);
    expect(out.columns[2].values).toEqual([10, 20, null, 30]); // id=2 had no order
  });
  it("right: all right rows; key coalesces from the right when no left match", () => {
    const out = joinFrames(customers, orders, opts("right"));
    expect(out.columns[0].values).toEqual([1, 1, 3, 4]); // cust=4 coalesced into id
    expect(out.columns[1].values).toEqual(["A", "A", "C", null]);
    expect(out.columns[2].values).toEqual([10, 20, 30, 40]);
  });
  it("outer: all of both, unmatched filled null", () => {
    const out = joinFrames(customers, orders, opts("outer"));
    expect(out.columns[0].values).toEqual([1, 1, 2, 3, 4]);
    expect(out.columns[1].values).toEqual(["A", "A", "B", "C", null]);
    expect(out.columns[2].values).toEqual([10, 20, null, 30, 40]);
  });
  it("does not match null keys (SQL / Polars join_nulls=false)", () => {
    const l: FrameValue = {
      __frame: true,
      columns: [{ name: "id", type: "number", values: [1, null] }, { name: "n", type: "string", values: ["A", "B"] }],
    };
    const r: FrameValue = {
      __frame: true,
      columns: [{ name: "id", type: "number", values: [1, null] }, { name: "v", type: "number", values: [9, 8] }],
    };
    const inner = joinFrames(l, r, { leftKey: "id", rightKey: "id", how: "inner" });
    expect(inner.columns[0].values).toEqual([1]); // the two null rows do NOT match each other
    expect(inner.columns[2].values).toEqual([9]);
    const left = joinFrames(l, r, { leftKey: "id", rightKey: "id", how: "left" });
    expect(left.columns[0].values).toEqual([1, null]); // null-key left row kept, right side null
    expect(left.columns[2].values).toEqual([9, null]);
  });
  it("de-dupes a colliding non-key column name", () => {
    const r2: FrameValue = {
      __frame: true,
      columns: [
        { name: "cust", type: "number", values: [1] },
        { name: "name", type: "string", values: ["order-1"] }, // collides with customers.name
      ],
    };
    const out = joinFrames(customers, r2, opts("inner"));
    expect(out.columns.map((c) => c.name)).toEqual(["id", "name", "name2"]);
  });
});

describe("join — asof (prices/trades: every left row kept, nearest right by time)", () => {
  // trades at t = -1 (before any quote), 1, 5, 10, 20 (after every quote)
  const trades: FrameValue = {
    __frame: true,
    columns: [{ name: "t", type: "number", values: [-1, 1, 5, 10, 20] }],
  };
  // quotes at t = 0, 2, 4, 8, 12
  const quotes: FrameValue = {
    __frame: true,
    columns: [
      { name: "t", type: "number", values: [0, 2, 4, 8, 12] },
      { name: "px", type: "number", values: [100, 101, 102, 103, 104] },
    ],
  };
  const asofOpts = (asofDirection: "backward" | "forward" | "nearest", asofTolerance?: number) =>
    ({ leftKey: "t", rightKey: "t", how: "asof" as const, asofDirection, asofTolerance });

  it("backward: latest right key ≤ left key; every left row kept, original order", () => {
    const out = joinFrames(trades, quotes, asofOpts("backward"));
    expect(out.columns[0].values).toEqual([-1, 1, 5, 10, 20]); // LEFT order preserved
    expect(out.columns[1].values).toEqual([null, 100, 102, 103, 104]);
  });

  it("forward: earliest right key ≥ left key", () => {
    const out = joinFrames(trades, quotes, asofOpts("forward"));
    expect(out.columns[1].values).toEqual([100, 101, 103, 104, null]);
  });

  it("nearest: whichever is closer; a tie favors backward", () => {
    const out = joinFrames(trades, quotes, asofOpts("nearest"));
    // t=-1: only forward (0) exists -> 100. t=1: |1-0|=|1-2|=1 tie -> backward (100).
    // t=5: |5-4|=1 < |5-8|=3 -> backward (102). t=10: |10-8|=|10-12|=2 tie -> backward (103).
    // t=20: only backward (12) exists -> 104.
    expect(out.columns[1].values).toEqual([100, 100, 102, 103, 104]);
  });

  it("tolerance excludes a match beyond the max key distance", () => {
    const out = joinFrames(trades, quotes, asofOpts("backward", 1));
    // t=5's backward match (t=4, diff 1) is within tolerance; t=10's (t=8, diff 2) is not.
    expect(out.columns[1].values).toEqual([null, 100, 102, null, null]);
  });

  it("never matches a null/error key row (same rule as an equality join)", () => {
    const gappy: FrameValue = { __frame: true, columns: [{ name: "t", type: "number", values: [null, 5] }] };
    const out = joinFrames(gappy, quotes, asofOpts("backward"));
    expect(out.columns[1].values).toEqual([null, 102]);
  });

  it("rejects a non-orderable (string/logical) key with #VALUE!", () => {
    const strKeyed: FrameValue = { __frame: true, columns: [{ name: "k", type: "string", values: ["a"] }] };
    const strRight: FrameValue = { __frame: true, columns: [{ name: "k", type: "string", values: ["a"] }, { name: "v", type: "number", values: [1] }] };
    const err = (() => { try { joinFrames(strKeyed, strRight, { leftKey: "k", rightKey: "k", how: "asof" }); } catch (e) { return e; } })();
    expect(isSolError(err) && err.code).toBe("#VALUE!");
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
  it("unpivot melts value columns into variable/value rows", () => {
    const out = unpivotFrame(wide, ["city"], ["jan", "feb"]);
    expect(out.columns.map((c) => c.name)).toEqual(["city", "variable", "value"]);
    expect(out.columns[0].values).toEqual(["Oslo", "Oslo", "Bergen", "Bergen"]);
    expect(out.columns[1].values).toEqual(["jan", "feb", "jan", "feb"]);
    expect(out.columns[2].values).toEqual([1, 2, 3, 4]);
  });
  it("pivot is the inverse: long → wide recovers the matrix", () => {
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
  it("unnest is the inverse: cube → flat recovers the rows", () => {
    const back = unnestCube(nestFrame(flat, ["cust"], "orders"), "orders");
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
});

describe("append (union by name)", () => {
  it("stacks identical schemas into a plain concat", () => {
    const a: FrameValue = { __frame: true, columns: [
      { name: "x", type: "number", values: [1, 2] }, { name: "y", type: "string", values: ["a", "b"] }] };
    const b: FrameValue = { __frame: true, columns: [
      { name: "x", type: "number", values: [3] }, { name: "y", type: "string", values: ["c"] }] };
    const out = appendFrames([a, b]);
    expect(out.columns[0].values).toEqual([1, 2, 3]);
    expect(out.columns[1].values).toEqual(["a", "b", "c"]);
  });
  it("unions differing columns, filling absent ones with null", () => {
    const a: FrameValue = { __frame: true, columns: [{ name: "x", type: "number", values: [1] }] };
    const b: FrameValue = { __frame: true, columns: [{ name: "z", type: "string", values: ["q"] }] };
    const out = appendFrames([a, b]);
    expect(out.columns.map((c) => c.name)).toEqual(["x", "z"]);
    expect(out.columns[0].values).toEqual([1, null]);  // b had no x
    expect(out.columns[1].values).toEqual([null, "q"]); // a had no z
  });
  it("#TYPE!s when a shared column name has conflicting types (reject-on-mismatch)", () => {
    const a: FrameValue = { __frame: true, columns: [{ name: "k", type: "number", values: [1] }] };
    const b: FrameValue = { __frame: true, columns: [{ name: "k", type: "string", values: ["x"] }] };
    let err: unknown;
    try { appendFrames([a, b]); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected a SolError");
    expect(err.code).toBe("#TYPE!");
  });
});

describe("applyVerb dispatch", () => {
  it("routes each unary op kind", () => {
    expect(applyVerb(f, { kind: "select", columns: ["id"] }).columns).toHaveLength(1);
    expect(applyVerb(f, { kind: "drop", columns: ["id"] }).columns).toHaveLength(2);
    expect(applyVerb(f, { kind: "rename", map: { id: "x" } }).columns[0].name).toBe("x");
    expect(applyVerb(f, { kind: "sort", by: "qty", dir: "desc" }).columns[2].values).toEqual([30, 20, 10]);
    expect(applyVerb(f, { kind: "distinct" }).columns[0].values).toHaveLength(3);
    expect(applyVerb(f, { kind: "head", n: 1 }).columns[0].values).toEqual([1]);
    expect(applyVerb(f, { kind: "filter", column: "qty", op: "gt", value: 15 }).columns[0].values).toEqual([2, 3]);
    expect(applyVerb(f, { kind: "groupBy", keys: ["name"], aggs: [{ column: "qty", op: "sum", as: "s" }] }).columns).toHaveLength(2);
    expect(applyVerb(f, { kind: "unpivot", idColumns: ["id"], valueColumns: ["qty"] }).columns.map((c) => c.name)).toEqual(["id", "variable", "value"]);
    expect(applyVerb(f, { kind: "pivot", rowFields: ["id"], colFields: ["name"], values: ["qty"], funcs: ["sum"] }).columns[0].values).toEqual([1, 2, 3]);
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

// ── v1.0 audit parity fixes (findings 16, 17, 31, 32) ─────────────────────────

describe("filter value coercion — the one spec (audit finding 16)", () => {
  const t: FrameValue = {
    __frame: true,
    columns: [
      { name: "v", type: "number", values: [1000, 1234] },
      { name: "flag", type: "logical", values: [true, false] },
    ],
  };
  const rows = (out: FrameValue) => out.columns[0].values.length;

  it("an unparseable numeric value matches NO rows (even neq)", () => {
    expect(rows(filterRows(t, "v", "eq", "1,234"))).toBe(0); // no comma stripping
    expect(rows(filterRows(t, "v", "neq", "garbage"))).toBe(0);
    expect(rows(filterRows(t, "v", "gt", ""))).toBe(0);
  });
  it("numeric strings parse after a trim", () => {
    expect(rows(filterRows(t, "v", "gt", " 1100 "))).toBe(1);
  });
  it("a logical column accepts \"false\" (it was truthy → matched TRUE rows)", () => {
    const out = filterRows(t, "flag", "eq", "false");
    expect(out.columns[1].values).toEqual([false]);
    expect(rows(filterRows(t, "flag", "eq", "TRUE"))).toBe(1);
  });
});

describe("logical columns aggregate as 1/0 (audit finding 17)", () => {
  it("GroupBy SUM over a logical column counts the TRUEs", () => {
    const t: FrameValue = {
      __frame: true,
      columns: [
        { name: "k", type: "string", values: ["a", "a", "a"] },
        { name: "flag", type: "logical", values: [true, false, true] },
      ],
    };
    const out = groupByFrame(t, ["k"], [{ column: "flag", op: "sum", as: "s" }, { column: "flag", op: "avg", as: "m" }]);
    expect(out.columns[1].values).toEqual([2]);
    expect(out.columns[2].values[0]).toBeCloseTo(2 / 3, 12);
  });
});

describe("NaN cells are REAL, present dirty data (B-1b — supersedes audit finding 31)", () => {
  // Finding 31 classified NaN as missing because the IPC nulled it; the __nf
  // wire sentinel removed that premise. NaN is now PRESENT-but-dirty: counted,
  // poisoning aggregates loudly (#DOMAIN!), tail-sorted, failing predicates.
  const t: FrameValue = {
    __frame: true,
    columns: [{ name: "v", type: "number", values: [1, NaN, 3] }],
  };
  it("count counts it, sum poisons to #DOMAIN!, filter still drops it, sort tails it", () => {
    const g = groupByFrame(
      { __frame: true, columns: [{ name: "k", type: "string", values: ["a", "a", "a"] }, ...t.columns] },
      ["k"],
      [{ column: "v", op: "count", as: "n" }, { column: "v", op: "sum", as: "s" }],
    );
    expect(g.columns[1].values).toEqual([3]);               // present, not missing
    const sum = g.columns[2].values[0];
    expect(isSolError(sum) && sum.code).toBe("#DOMAIN!");   // dirty data poisons loudly
    expect(filterRows(t, "v", "gte", 0).columns[0].values).toEqual([1, 3]); // NaN passes no predicate
    const sorted = sortByColumn(t, "v", "asc").columns[0].values;
    expect(sorted[0]).toBe(1);
    expect(sorted[1]).toBe(3);
    expect(Number.isNaN(sorted[2])).toBe(true);             // deterministic tail
  });
});

describe("duplicate output names dedupe (audit finding 32)", () => {
  it("groupBy: an agg named after the key gets a makeHeaders suffix", () => {
    const out = groupByFrame(f, ["name"], [{ column: "qty", op: "count", as: "name" }]);
    expect(out.columns.map((c) => c.name)).toEqual(["name", "name2"]);
  });
  it("select: a repeated name keeps the first occurrence only", () => {
    const out = selectColumns(f, ["id", "id", "qty"]);
    expect(out.columns.map((c) => c.name)).toEqual(["id", "qty"]);
  });
});
