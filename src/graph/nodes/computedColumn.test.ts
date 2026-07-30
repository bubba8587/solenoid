import { describe, it, expect } from "vitest";
import { ComputedColumnNode, FrameInputNode } from "./frame";
import { LambdaNode } from "./lambda";
import { compileEvaluator, rowRefNames } from "../excelFormula";
import { getColumn, frameSourceToText, parseFrameSource, type FrameValue } from "../frame";
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

  it("col() of an absent column becomes a side port reading its default, like an unknown variable", () => {
    const n = named('col("nope") + 1', "x");
    const r = run(n, sales) as FrameValue;
    expect(getColumn(r, "x")!.values).toEqual([1, 1, 1]);
    expect(n.sideVars).toContain("nope");
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

describe("Frame Input λ columns (surface slice 1)", () => {
  const src = (cols: Parameters<typeof frameSourceToText>[0]) => frameSourceToText(cols);
  const lambda = (expr: string, params: string) =>
    (new LambdaNode({ expr, params }).data({}) as { result: unknown }).result;

  it("a λ-bound column computes per row over the literal columns", () => {
    const n = new FrameInputNode({
      frameText: src([
        { name: "a", type: "number", cells: ["1", "2", "3"] },
        { name: "b", type: "number", cells: ["10", "20", "30"] },
        { name: "sum", type: "number", cells: [], lambda: "fn1" },
      ]),
      lambdaKeys: ["fn1"],
    });
    const out = n.data({ fn1: [lambda("a + b", "a, b")] }).frame as FrameValue;
    expect(getColumn(out, "sum")!.values).toEqual([11, 22, 33]);
    // Literal columns keep their raw text; the computed column has none.
    expect(getColumn(out, "a")!.raw).toEqual(["1", "2", "3"]);
    expect(getColumn(out, "sum")!.raw).toBeUndefined();
  });

  it("a computed column can reference another computed column (topo order)", () => {
    const n = new FrameInputNode({
      frameText: src([
        { name: "qty", type: "number", cells: ["2", "4"] },
        { name: "margin", type: "number", cells: [], lambda: "fn2" }, // declared FIRST, depends on revenue
        { name: "revenue", type: "number", cells: [], lambda: "fn1" },
      ]),
      lambdaKeys: ["fn1", "fn2"],
    });
    const out = n.data({
      fn1: [lambda("qty * 10", "qty")],
      fn2: [lambda("revenue / 2", "revenue")],
    }).frame as FrameValue;
    expect(getColumn(out, "revenue")!.values).toEqual([20, 40]);
    expect(getColumn(out, "margin")!.values).toEqual([10, 20]);
  });

  it("a cycle between computed columns refuses per column with #REF!", () => {
    const n = new FrameInputNode({
      frameText: src([
        { name: "x", type: "number", cells: ["1"] },
        { name: "p", type: "number", cells: [], lambda: "fn1" },
        { name: "q", type: "number", cells: [], lambda: "fn2" },
      ]),
      lambdaKeys: ["fn1", "fn2"],
    });
    const out = n.data({
      fn1: [lambda("q + 1", "q")],
      fn2: [lambda("p + 1", "p")],
    }).frame as FrameValue;
    const p = getColumn(out, "p")!.values[0];
    expect(isSolError(p) && p.message).toContain("Circular");
    expect(isSolError(getColumn(out, "q")!.values[0])).toBe(true);
    // The literal column is untouched by the cycle.
    expect(getColumn(out, "x")!.values).toEqual([1]);
  });

  it("an unwired λ socket leaves the column blank; an unbound param is a per-row #REF!", () => {
    const n = new FrameInputNode({
      frameText: src([
        { name: "a", type: "number", cells: ["1", "2"] },
        { name: "c1", type: "number", cells: [], lambda: "fn1" },
        { name: "c2", type: "number", cells: [], lambda: "fn2" },
      ]),
      lambdaKeys: ["fn1", "fn2"],
    });
    const out = n.data({ fn2: [lambda("ghost * 2", "ghost")] }).frame as FrameValue;
    expect(getColumn(out, "c1")!.values).toEqual([null, null]);
    const c2 = getColumn(out, "c2")!.values[0];
    expect(isSolError(c2) && c2.message).toContain("captures");
  });

  it("removing a λ row unbinds its columns back to Typed; lambdaKeys round-trips extractInit", () => {
    const n = new FrameInputNode({
      frameText: src([
        { name: "a", type: "number", cells: ["1"] },
        { name: "c", type: "number", cells: [], lambda: "fn1" },
      ]),
      lambdaKeys: ["fn1"],
    });
    const init = extractInit(n) as { lambdaKeys?: string[] };
    expect(init.lambdaKeys).toEqual(["fn1"]);
    n.removeValueInput("fn1");
    expect(n.lambdaKeys).toEqual([]);
    expect(parseFrameSource(n.frameText).find((c) => c.name === "c")!.lambda).toBeUndefined();
  });
});

describe("Frame Input Formula columns (surface slice 2)", () => {
  it("an expr column computes per row over the literal columns — no wiring at all", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "price", type: "number", cells: ["10", "20"] },
        { name: "qty", type: "number", cells: ["2", "3"] },
        { name: "rev", type: "number", cells: [], expr: "price * qty" },
      ]),
    });
    const out = n.data({}).frame as FrameValue;
    expect(getColumn(out, "rev")!.values).toEqual([20, 60]);
    expect(getColumn(out, "rev")!.raw).toBeUndefined();
  });

  it("@ reads work in an expr column, and pure-@ deps still topo-order", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "qty", type: "number", cells: ["2", "4"] },
        { name: "margin", type: "number", cells: [], expr: "@revenue / 2" }, // declared FIRST
        { name: "revenue", type: "number", cells: [], expr: "@qty * 10" },
      ]),
    });
    const out = n.data({}).frame as FrameValue;
    expect(getColumn(out, "revenue")!.values).toEqual([20, 40]);
    expect(getColumn(out, "margin")!.values).toEqual([10, 20]);
  });

  it("expr and λ columns share one topo — an expr can read a λ column", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "qty", type: "number", cells: ["2", "4"] },
        { name: "half", type: "number", cells: [], expr: "revenue / 2" },
        { name: "revenue", type: "number", cells: [], lambda: "fn1" },
      ]),
      lambdaKeys: ["fn1"],
    });
    const lam = (new LambdaNode({ expr: "qty * 10", params: "qty" }).data({}) as { result: unknown }).result;
    const out = n.data({ fn1: [lam] }).frame as FrameValue;
    expect(getColumn(out, "half")!.values).toEqual([10, 20]);
  });

  it("an expr cycle refuses per column with #REF!; a variable naming no column is a per-row #REF!", () => {
    const cyc = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "x", type: "number", cells: ["1"] },
        { name: "p", type: "number", cells: [], expr: "q + 1" },
        { name: "q", type: "number", cells: [], expr: "p + 1" },
      ]),
    });
    const out = cyc.data({}).frame as FrameValue;
    const p = getColumn(out, "p")!.values[0];
    expect(isSolError(p) && p.message).toContain("Circular");
    const ghost = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "a", type: "number", cells: ["1"] },
        { name: "c", type: "number", cells: [], expr: "ghost * 2" },
      ]),
    });
    const g = (getColumn(ghost.data({}).frame as FrameValue, "c")!.values[0]);
    expect(isSolError(g) && g.message).toBe('No column "ghost"');
  });

  it("a non-parsing expr fills the column with #VALUE!", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "a", type: "number", cells: ["1", "2"] },
        { name: "bad", type: "number", cells: [], expr: "a +* 2" },
      ]),
    });
    const v = getColumn(n.data({}).frame as FrameValue, "bad")!.values[0];
    expect(isSolError(v) && v.code).toBe("#VALUE!");
  });

  it("a λ binding wins over a stale expr (the wired, reusable definition)", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "a", type: "number", cells: ["3"] },
        { name: "c", type: "number", cells: [], lambda: "fn1", expr: "a * 100" },
      ]),
      lambdaKeys: ["fn1"],
    });
    const lam = (new LambdaNode({ expr: "a + 1", params: "a" }).data({}) as { result: unknown }).result;
    expect(getColumn(n.data({ fn1: [lam] }).frame as FrameValue, "c")!.values).toEqual([4]);
  });

  it("expr rides the frameText round-trip; a blank expr is dropped on parse", () => {
    const text = frameSourceToText([
      { name: "a", type: "number", cells: ["1"] },
      { name: "c", type: "number", cells: [], expr: "a * 2" },
      { name: "d", type: "number", cells: ["5"], expr: "  " },
    ]);
    const back = parseFrameSource(text);
    expect(back.find((c) => c.name === "c")!.expr).toBe("a * 2");
    expect(back.find((c) => c.name === "d")!.expr).toBeUndefined();
  });
});

describe("the @ operator — this-row reads (Excel [@Price] as @price)", () => {
  it("@ works in the CC node's inline formula, mixed with bound variables", () => {
    const r = run(named("@price * qty", "rev"), sales) as FrameValue;
    expect(getColumn(r, "rev")!.values).toEqual([20, 60, 120]);
  });

  it("a ZERO-param λ reads the row via @ — capture sockets grow, columns win over them", () => {
    const lam = new LambdaNode({ expr: "@price * @qty", params: "" });
    const fn = (lam.data({}) as { result: unknown }).result;
    // @names grow capture sockets like any free variable (the λ owns its
    // names — author ruling 2026-07-30); on a table the COLUMNS win at
    // row-eval, so the unwired captures are inert and the λ still computes
    // with no wiring at all.
    expect(lam.captured).toEqual(["price", "qty"]);
    const r = run(named("", "rev"), sales, { fn: [fn] }) as FrameValue;
    expect(getColumn(r, "rev")!.values).toEqual([20, 60, 120]);
  });

  it("col() now works INSIDE a λ body too (the row context is dynamic)", () => {
    const awkward: FrameValue = {
      __frame: true,
      columns: [{ name: "Unit Price", type: "number", values: [5, 7] }],
    };
    const lam = new LambdaNode({ expr: 'col("Unit Price") * 2', params: "" });
    const fn = (lam.data({}) as { result: unknown }).result;
    const r = run(named("", "dbl"), awkward, { fn: [fn] }) as FrameValue;
    expect(getColumn(r, "dbl")!.values).toEqual([10, 14]);
  });

  it("a zero-param λ using @ still orders after the column it reads (Frame Input topo)", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "qty", type: "number", cells: ["2", "4"] },
        { name: "margin", type: "number", cells: [], lambda: "fn2" }, // reads @revenue
        { name: "revenue", type: "number", cells: [], lambda: "fn1" },
      ]),
      lambdaKeys: ["fn1", "fn2"],
    });
    const mk = (expr: string) => (new LambdaNode({ expr, params: "" }).data({}) as { result: unknown }).result;
    const out = n.data({ fn1: [mk("@qty * 10")], fn2: [mk("@revenue / 2")] }).frame as FrameValue;
    expect(getColumn(out, "revenue")!.values).toEqual([20, 40]);
    expect(getColumn(out, "margin")!.values).toEqual([10, 20]);
  });

  it("outside a row context, @ and COL answer a targeted #REF!, not a typo's #NAME?", () => {
    const r = compileEvaluator("@price + 1")!({});
    expect(isSolError(r) && r.code).toBe("#REF!");
    expect(isSolError(r) && r.message).toContain("current row");
    const c = compileEvaluator('COL("price")')!({});
    expect(isSolError(c) && c.code).toBe("#REF!");
  });

  it("rowRefNames feeds the topo: @names and col() literals, no variables", () => {
    expect(rowRefNames('@a + col("b c") * col(2024) + qty').sort()).toEqual(["2024", "a", "b c"]);
  });
});

describe("@ over side values — row-aligned lists (no capture, no column)", () => {
  // The author's shape: λ(framecol1, framecol2) → framecol1*framecol2*@list.
  // `list` is neither a param nor a column — it grows a CAPTURE socket on the
  // LAMBDA node (the λ owns its names), and @ reads the captured list
  // element-per-row inside the row context.
  it("a λ's @list rides the Lambda card's capture socket, element per row", () => {
    const lam = new LambdaNode({ expr: "qty * price * @scale", params: "qty, price" });
    expect(lam.captured).toEqual(["scale"]); // the @name grew a capture socket
    // Unwired capture: @scale reads the 0 default, same every row.
    const bare = (lam.data({}) as { result: unknown }).result;
    const n = named("", "prod");
    const r1 = run(n, sales, { fn: [bare] }) as FrameValue;
    expect(getColumn(r1, "prod")!.values).toEqual([0, 0, 0]);
    // The λ's captured names never grow CC side ports — the definition owns them.
    expect(n.sideVars).toEqual([]);
    // List wired to the capture: element per row, in the frame's row order.
    const fn = (lam.data({ scale: [[1, 2, 3]] }) as { result: unknown }).result;
    const r2 = run(n, sales, { fn: [fn] }) as FrameValue;
    expect(getColumn(r2, "prod")!.values).toEqual([20, 120, 360]); // 2·10·1, 3·20·2, 4·30·3
    // A captured list that doesn't line up with the rows: per-row #SHAPE!.
    const short = (lam.data({ scale: [[1, 2]] }) as { result: unknown }).result;
    const r3 = run(n, sales, { fn: [short] }) as FrameValue;
    const v = getColumn(r3, "prod")!.values[0];
    expect(isSolError(v) && v.code).toBe("#SHAPE!");
  });

  it("an inline expr's @list works the same, and a scalar side value reads every row", () => {
    const n = named("@price * @factor", "adj");
    run(n, sales); // grow the port
    const r = run(n, sales, { factor: [[2, 0, 1]] }) as FrameValue;
    expect(getColumn(r, "adj")!.values).toEqual([20, 0, 30]);
    const s = run(n, sales, { factor: [10] }) as FrameValue;
    expect(getColumn(s, "adj")!.values).toEqual([100, 200, 300]);
  });

  it("a side list that doesn't line up with the rows is a per-row #SHAPE! naming both", () => {
    const n = named("@price * @factor", "adj");
    run(n, sales);
    const r = run(n, sales, { factor: [[1, 2]] }) as FrameValue;
    const v = getColumn(r, "adj")!.values[0];
    expect(isSolError(v) && v.code).toBe("#SHAPE!");
    expect(isSolError(v) && v.message).toContain("2 values for 3 rows");
  });

  it("col() reaches the side list too — full @/col symmetry", () => {
    const n = named('price * col("factor")', "adj");
    run(n, sales);
    const r = run(n, sales, { factor: [[1, 2, 3]] }) as FrameValue;
    expect(getColumn(r, "adj")!.values).toEqual([10, 40, 90]);
  });

  it("a COLUMN of the same name wins over the side value, and @-misses don't fire in Frame Input", () => {
    const n = named("@qty + 0", "q2");
    const r = run(n, sales, { qty: [[100, 100, 100]] }) as FrameValue;
    expect(getColumn(r, "q2")!.values).toEqual([2, 3, 4]); // the column, not the wire
    // Frame Input's per-column sources have no side ports by design: an @name
    // that matches no column stays a plain per-row #REF! there.
    const fi = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "a", type: "number", cells: ["1"] },
        { name: "c", type: "number", cells: [], expr: "@ghost + a" },
      ]),
    });
    const g = getColumn(fi.data({}).frame as FrameValue, "c")!.values[0];
    expect(isSolError(g) && g.message).toBe('No column "ghost"');
  });
});

describe("binding pickers — explicit variable → column bindings", () => {
  it("a bound variable reads its picked column, whatever its own name", () => {
    const n = named("a * 2", "dbl");
    n.bindings = { a: "price" };
    const r = run(n, sales) as FrameValue;
    expect(getColumn(r, "dbl")!.values).toEqual([20, 40, 60]);
    // λ params bind the same way through the shared core.
    const lam = new LambdaNode({ expr: "x + 1", params: "x" });
    const fn = (lam.data({}) as { result: unknown }).result;
    const m = named("", "inc");
    m.bindings = { x: "qty" };
    const r2 = run(m, sales, { fn: [fn] }) as FrameValue;
    expect(getColumn(r2, "inc")!.values).toEqual([3, 4, 5]);
  });

  it("binding a would-be side variable to a column removes its socket role", () => {
    const n = named("k + qty", "sum");
    n.bindings = { k: "price" };
    const r = run(n, sales) as FrameValue;
    expect(getColumn(r, "sum")!.values).toEqual([12, 23, 34]);
    expect(n.sideVars).toEqual([]);
  });

  it("a stale binding (its column gone) is a #REF! naming both ends — never a silent fallback", () => {
    const n = named("a * 2", "dbl");
    n.bindings = { a: "vanished" };
    const r = run(n, sales);
    expect(isSolError(r) && r.message).toContain('"vanished"');
    expect(isSolError(r) && r.message).toContain('"a"');
  });

  it("extractInit persists bindings for LIVE variables only, keys sorted", () => {
    const n = named("b + a", "s");
    n.bindings = { b: "price", a: "qty", ghost: "city" };
    run(n, sales); // stashes defVars = [b, a]
    const init = extractInit(n) as { bindings?: Record<string, string> };
    expect(Object.keys(init.bindings!)).toEqual(["a", "b"]);
    expect(init.bindings).toEqual({ a: "qty", b: "price" });
    // The constructor applies them back.
    const back = new ComputedColumnNode({ expr: "b + a", bindings: init.bindings });
    expect(back.bindings).toEqual({ a: "qty", b: "price" });
  });
});

describe("identity-stable outputs — the backend upload cache holds across passes", () => {
  it("an unchanged pass returns the SAME objects: λ value, CC frame", () => {
    const lam = new LambdaNode({ expr: "qty * 2", params: "qty" });
    const v1 = (lam.data({}) as { result: unknown }).result;
    const v2 = (lam.data({}) as { result: unknown }).result;
    expect(v2).toBe(v1);
    // A changed capture input mints a new value.
    const lam2 = new LambdaNode({ expr: "qty * k", params: "qty" });
    const a = (lam2.data({ k: [2] }) as { result: unknown }).result;
    const b = (lam2.data({ k: [3] }) as { result: unknown }).result;
    expect(b).not.toBe(a);

    const n = named("price * qty", "rev");
    const r1 = run(n, sales) as FrameValue;
    const r2 = run(n, sales) as FrameValue;
    expect(r2).toBe(r1);
    // A different input frame (new identity) recomputes.
    const r3 = run(n, { ...sales }) as FrameValue;
    expect(r3).not.toBe(r1);
    // A config change recomputes.
    n.stringLiterals.name = "revenue";
    expect(run(n, { ...sales })).not.toBe(r3);
  });

  it("a changed side value or binding busts the CC memo; Frame Input computed frames are stable per (text, λ identities)", () => {
    const n = named("price * (1 - disc)", "net");
    run(n, sales); // grows disc
    const r1 = run(n, sales, { disc: [0.1] }) as FrameValue;
    expect(run(n, sales, { disc: [0.1] })).toBe(r1);
    const r2 = run(n, sales, { disc: [0.2] }) as FrameValue;
    expect(r2).not.toBe(r1);
    expect(getColumn(r2, "net")!.values).toEqual([8, 16, 24]);
    n.bindings = { disc: "qty" };
    expect(run(n, sales, { disc: [0.2] })).not.toBe(r2);

    const fi = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "a", type: "number", cells: ["1", "2"] },
        { name: "c", type: "number", cells: [], lambda: "fn1" },
      ]),
      lambdaKeys: ["fn1"],
    });
    const lam = new LambdaNode({ expr: "a + 1", params: "a" });
    const fn = (lam.data({}) as { result: unknown }).result;
    const f1 = fi.data({ fn1: [fn] }).frame as FrameValue;
    expect(fi.data({ fn1: [fn] }).frame).toBe(f1);
    // A new λ identity (an edit upstream) recomputes.
    const fn2 = (new LambdaNode({ expr: "a + 2", params: "a" }).data({}) as { result: unknown }).result;
    expect(fi.data({ fn1: [fn2] }).frame).not.toBe(f1);
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

  it("sideVars persist and the constructor regrows the sockets — a saved side cable finds its port at load", () => {
    const n = named("price * (1 - disc)", "net");
    run(n, sales); // grows the disc side socket
    expect(n.sideVars).toEqual(["disc"]);
    const init = extractInit(n) as { sideVars?: string[] };
    expect(init.sideVars).toEqual(["disc"]);
    const clone = new ComputedColumnNode(init as ConstructorParameters<typeof ComputedColumnNode>[0]);
    expect(clone.sideVars).toEqual(["disc"]);
    expect(clone.inputs.disc).toBeDefined(); // the socket exists BEFORE any compute
  });
});
