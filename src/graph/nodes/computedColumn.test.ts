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

  it("an unknown variable refuses with #REF! naming it", () => {
    const r = run(named("qty * pric"), sales);
    expect(isSolError(r) && r.code).toBe("#REF!");
    expect(isSolError(r) && r.message).toContain('"pric"');
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

  it("a λ param that names no column is #REF!", () => {
    const fn = lambdaFor("cost * 2", "cost");
    const r = run(named("", "x"), sales, { fn: [fn] });
    expect(isSolError(r) && r.code).toBe("#REF!");
    expect(isSolError(r) && r.message).toContain('"cost"');
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
