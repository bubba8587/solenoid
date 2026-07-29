import { describe, it, expect } from "vitest";
import { ComputedColumnNode } from "./frame";
import { LambdaNode } from "./lambda";
import { getColumn, type FrameValue } from "../frame";
import { solError, isSolError } from "../errorValue";
import { extractInit } from "../copyPaste";

// ─── Computed Column — the row-wise formula verb ─────────────────────────────
// The node that keeps frames OUT of formulas (D23): the row iteration lives
// here, the formula only ever sees scalars. Variables are column names; a
// wired λ takes over with its params bound the same way.

const sales: FrameValue = {
  __frame: true,
  columns: [
    { name: "qty", type: "number", values: [2, 3, 4] },
    { name: "price", type: "number", values: [10, 20, 30] },
    { name: "city", type: "string", values: ["Oslo", "Bergen", "Tromsø"] },
  ],
};

const run = (node: ComputedColumnNode, frame: FrameValue | null, extra?: Record<string, unknown[]>) =>
  node.data({ frame: [frame], ...(extra ?? {}) } as Parameters<ComputedColumnNode["data"]>[0]).frame;

const named = (expr: string, name = "computed") => {
  const n = new ComputedColumnNode({ expr });
  n.stringLiterals.name = name;
  return n;
};

describe("ComputedColumnNode — inline formula", () => {
  it("computes row by row; variables are column names; type is inferred", () => {
    expect(run(named("qty * price", "revenue"), null)).toBeNull(); // no frame → null
    const r = run(named("qty * price", "revenue"), sales) as FrameValue;
    const col = getColumn(r, "revenue")!;
    expect(col.type).toBe("number");
    expect(col.values).toEqual([20, 60, 120]);
    // Source columns untouched, in place, output appended last.
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "price", "city", "revenue"]);
  });

  it("text results infer a string column; functions dispatch normally", () => {
    const r = run(named('UPPER(city) & "!"', "shout"), sales) as FrameValue;
    const col = getColumn(r, "shout")!;
    expect(col.type).toBe("string");
    expect(col.values).toEqual(["OSLO!", "BERGEN!", "TROMSØ!"]);
  });

  it("a blank formula passes the frame through untouched", () => {
    expect(run(named(""), sales)).toBe(sales);
  });

  it("an unparsable formula is #VALUE!", () => {
    const r = run(named("qty *"), sales);
    expect(isSolError(r) && r.code).toBe("#VALUE!");
  });

  it("replaces an existing column when the name collides (addColumn semantics)", () => {
    const r = run(named("qty * 2", "qty"), sales) as FrameValue;
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "price", "city"]);
    expect(getColumn(r, "qty")!.values).toEqual([4, 6, 8]);
  });

  it("a `Name (unit)` header tags the unit like Add Column", () => {
    const r = run(named("qty * price", "revenue (usd)"), sales) as FrameValue;
    const col = r.columns[r.columns.length - 1];
    expect(col.name).toBe("revenue");
    expect((col.unit as { display?: string } | undefined)?.display).toBe("usd");
  });
});

describe("ComputedColumnNode — the per-row contract", () => {
  it("an error cell in a bound column propagates to that row only", () => {
    const err = solError("#DIV/0!", "x");
    const f: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [1, err, 3] }],
    };
    const r = run(named("v * 10", "out"), f) as FrameValue;
    expect(getColumn(r, "out")!.values).toEqual([10, err, 30]);
  });

  it("a null cell flows INTO the formula — ISBLANK can see it", () => {
    const f: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [1, null, 3] }],
    };
    const r = run(named('IF(ISBLANK(v), "missing", "here")', "flag"), f) as FrameValue;
    expect(getColumn(r, "flag")!.values).toEqual(["here", "missing", "here"]);
  });

  it("a NaN result is #DOMAIN! per row; a list result is #SHAPE!", () => {
    const f: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [4, -4] }],
    };
    const sq = run(named("SQRT(v)", "root"), f) as FrameValue;
    const vals = getColumn(sq, "root")!.values;
    expect(vals[0]).toBe(2);
    expect(isSolError(vals[1])).toBe(true);
    const seq = run(named("SEQUENCE(3)", "spill"), f) as FrameValue;
    expect(isSolError(getColumn(seq, "spill")!.values[0])).toBe(true);
  });

  it("an empty frame computes an empty column, typed", () => {
    const f: FrameValue = { __frame: true, columns: [{ name: "v", type: "number", values: [] }] };
    const r = run(named("v + 1", "out"), f) as FrameValue;
    expect(getColumn(r, "out")!.values).toEqual([]);
  });
});

describe("ComputedColumnNode — wired λ", () => {
  const lambdaFor = (expr: string, params: string) => {
    const lam = new LambdaNode({ expr, params });
    return (lam.data({}) as { result: unknown }).result;
  };

  it("the λ's params bind to columns by name and the λ wins over the inline expr", () => {
    const node = named("qty * 1000", "margin"); // inline would give a different answer
    const fn = lambdaFor("price - qty", "price, qty");
    const r = run(node, sales, { fn: [fn] }) as FrameValue;
    expect(getColumn(r, "margin")!.values).toEqual([8, 17, 26]);
  });

});

describe("ComputedColumnNode — side inputs, row, and the output type", () => {
  it("a variable naming no column becomes a SIDE INPUT (wired value or literal default)", () => {
    const n = named("price * (1 + taxrate)", "gross");
    // Wired: the side value is row-invariant.
    const wired = run(n, sales, { taxrate: [[0.25]] }) as FrameValue;
    expect(getColumn(wired, "gross")!.values).toEqual([12.5, 25, 37.5]);
    expect(n.sideVars).toEqual(["taxrate"]);
    // Unwired: the literal default (Expression convention: 0).
    const bare = run(named("price * (1 + taxrate)", "gross"), sales) as FrameValue;
    expect(getColumn(bare, "gross")!.values).toEqual([10, 20, 30]);
  });

  it("a whole LIST side input enables percent-of-total in one node", () => {
    const n = named("price / SUM(prices)", "share");
    const r = run(n, sales, { prices: [[10, 20, 30]] }) as FrameValue;
    expect(getColumn(r, "share")!.values.map((v) => (v as number).toFixed(4)))
      .toEqual(["0.1667", "0.3333", "0.5000"]);
  });

  it("`row` is the 1-based row number; a column named row shadows it", () => {
    const r = run(named("row * 10", "idx"), sales) as FrameValue;
    expect(getColumn(r, "idx")!.values).toEqual([10, 20, 30]);
    const withRowCol: FrameValue = {
      __frame: true,
      columns: [{ name: "row", type: "number", values: [7, 8, 9] }],
    };
    const shadowed = run(named("row * 10", "idx"), withRowCol) as FrameValue;
    expect(getColumn(shadowed, "idx")!.values).toEqual([70, 80, 90]);
  });

  it("a reserved input name refuses with #REF!", () => {
    const r = run(named("frame + 1"), sales);
    expect(isSolError(r) && r.code).toBe("#REF!");
  });

  it("addAs declares the output type where inference can't (date serials)", () => {
    const due: FrameValue = {
      __frame: true,
      columns: [{ name: "start", type: "date", values: [46000, 46010] }],
    };
    const auto = run(named("start + 7", "due"), due) as FrameValue;
    expect(getColumn(auto, "due")!.type).toBe("number"); // inference can't see date-ness
    const typedNode = named("start + 7", "due");
    typedNode.addAs = "date";
    const typed = run(typedNode, due) as FrameValue;
    expect(getColumn(typed, "due")!.type).toBe("date");
    expect(getColumn(typed, "due")!.values).toEqual([46007, 46017]);
  });

  it("a λ param naming no column becomes a side input too", () => {
    const lam = new LambdaNode({ expr: "price * rate", params: "price, rate" });
    const fn = (lam.data({}) as { result: unknown }).result;
    const n = named("", "scaled");
    const r = run(n, sales, { fn: [fn], rate: [[2]] }) as FrameValue;
    expect(getColumn(r, "scaled")!.values).toEqual([20, 40, 60]);
    expect(n.sideVars).toEqual(["rate"]);
  });
});

describe("ComputedColumnNode — col() accessor, rows, and placement", () => {
  it('col("name") reaches columns a variable cannot spell — numeric and spaced names', () => {
    const awkward: FrameValue = {
      __frame: true,
      columns: [
        { name: "2024", type: "number", values: [100, 200] },
        { name: "Unit Price", type: "number", values: [5, 7] },
      ],
    };
    const quoted = run(named('col("2024") + col("Unit Price")', "sum"), awkward) as FrameValue;
    expect(getColumn(quoted, "sum")!.values).toEqual([105, 207]);
    // A numeric literal coerces to the name — col(2024) reads the year column,
    // never a positional index.
    const bare = run(named("col(2024) * 2", "dbl"), awkward) as FrameValue;
    expect(getColumn(bare, "dbl")!.values).toEqual([200, 400]);
  });

  it("col() of an absent column is a per-row #REF!", () => {
    const r = run(named('col("nope") + 1', "x"), sales) as FrameValue;
    expect(isSolError(getColumn(r, "x")!.values[0])).toBe(true);
  });

  it("`rows` is the total row count (a column named rows shadows it)", () => {
    const r = run(named("row / rows", "frac"), sales) as FrameValue;
    expect(getColumn(r, "frac")!.values).toEqual([1 / 3, 2 / 3, 1]);
  });

  it("After places a NEW column right after the anchor; blank appends at the end", () => {
    const n = named("qty * price", "revenue");
    n.stringLiterals.after = "qty";
    const r = run(n, sales) as FrameValue;
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "revenue", "price", "city"]);
  });

  it("a REPLACED column keeps its position even with After set", () => {
    const n = named("qty * 2", "qty");
    n.stringLiterals.after = "city";
    const r = run(n, sales) as FrameValue;
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "price", "city"]);
    expect(getColumn(r, "qty")!.values).toEqual([4, 6, 8]);
  });

  it("a missing After anchor refuses with #REF!", () => {
    const n = named("qty * price", "revenue");
    n.stringLiterals.after = "ghost";
    const r = run(n, sales);
    expect(isSolError(r) && r.code).toBe("#REF!");
    expect(isSolError(r) && r.message).toContain('"ghost"');
  });
});

describe("ComputedColumnNode — kitchen sink", () => {
  it("text functions, IF chains, and mixed builtins compose in one row formula", () => {
    const r = run(named('IF(qty > 2, UPPER(city), LOWER(city)) & " #" & TEXT(row, "0")', "tag"), sales) as FrameValue;
    expect(getColumn(r, "tag")!.values).toEqual(["oslo #1", "BERGEN #2", "TROMSØ #3"]);
  });

  it("a λ that returns a SolError poisons only its row", () => {
    const lam = new LambdaNode({ expr: "IF(v < 0, NA(), v)", params: "v" });
    const fn = (lam.data({}) as { result: unknown }).result;
    const f: FrameValue = { __frame: true, columns: [{ name: "v", type: "number", values: [1, -1, 3] }] };
    const r = run(named("", "ok"), f, { fn: [fn] }) as FrameValue;
    const vals = getColumn(r, "ok")!.values;
    expect(vals[0]).toBe(1);
    expect(isSolError(vals[1])).toBe(true);
    expect(vals[2]).toBe(3);
  });

  it("col(), a bound column, row, and a side input all mix in one formula", () => {
    const n = named('col("qty") * price + row + base', "mix");
    const r = run(n, sales, { base: [[1000]] }) as FrameValue;
    expect(getColumn(r, "mix")!.values).toEqual([2 * 10 + 1 + 1000, 3 * 20 + 2 + 1000, 4 * 30 + 3 + 1000]);
  });
});

describe("persistence", () => {
  it("extractInit round-trips expr and the column name", () => {
    const n = named("qty * price", "revenue");
    const init = extractInit(n) as { expr?: string };
    expect(init.expr).toBe("qty * price");
    const clone = new ComputedColumnNode(init as ConstructorParameters<typeof ComputedColumnNode>[0]);
    expect(clone.expr).toBe("qty * price");
  });
});
