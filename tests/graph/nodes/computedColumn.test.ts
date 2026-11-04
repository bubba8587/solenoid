// [[C22]] rowFormulaRefs, [[C25]] firstClassUnits, [[computed-columns#Names inside a row]],
// [[computed-columns#Evaluating a column]], [[computed-columns#Fx columns in Frame Input]], [[computed-columns#The Computed Column node]]
import { GraphEditor } from "../../../src/graph/graphEditor";
import { DataflowEngine } from "../../../src/graph/dataflowEngine";
import type { Schemes } from "../../../src/graph/schemes";
import { describe, it, expect } from "vitest";
import { ComputedColumnNode, FrameInputNode } from "../../../src/graph/nodes/frame";
import { LambdaNode, perRowParamClashes } from "../../../src/graph/nodes/lambda";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { rowRefNames } from "../coreVerbs";
import { getColumn, frameSourceToText, parseFrameSource, type FrameValue } from "../../../src/graph/frame";
import { solError, isSolError } from "../../../src/graph/errorValue";
import { extractInit } from "../../../src/graph/nodeInit";
import { GraphConnection, GraphNode } from "../../../src/graph/graphModel";
import { frameOut } from "../../../src/graph/nodes/shared";

/** A Computed Column fed `frame` by a source card, computed in full passes as the app runs them; `feed` swaps the frame. */
async function inEditor(n: ComputedColumnNode) {
  let frame: FrameValue = sales;
  class Src extends GraphNode {
    constructor() { super("Src"); this.addOutput("frame", frameOut("Frame")); }
    data() { return { frame }; }
  }
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const src = new Src();
  await editor.addNode(src as never);
  await editor.addNode(n as never);
  await editor.addConnection(new GraphConnection(src, "frame", n, "frame") as never);
  return {
    pass: async () => { await engine.pass(undefined, undefined, false); return engine.landed(n.id, "frame") as FrameValue; },
    feed: (f: FrameValue) => { frame = f; src.edited(); },
    dispose: () => editor.dispose(),
  };
}

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

describe("ComputedColumnNode — inline formula (tableRefSemantics: bare = whole column, @ = this row)", () => {
  it("computes row by row via @ reads; type is inferred", () => {
    expect(run(named("@qty * @price", "revenue"), null)).toBeNull(); // no frame → null
    const r = run(named("@qty * @price", "revenue"), sales) as FrameValue;
    const col = getColumn(r, "revenue")!;
    expect(col.type).toBe("number");
    expect(col.values).toEqual([20, 60, 120]);
    // Source columns untouched, in place, output appended last.
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "price", "city", "revenue"]);
  });

  it("a bare column name is the WHOLE column — @revenue-style share-of-total works unwired", () => {
    const r = run(named("@price / SUM(price)", "share"), sales) as FrameValue;
    expect(getColumn(r, "share")!.values.map((v) => (v as number).toFixed(4)))
      .toEqual(["0.1667", "0.3333", "0.5000"]);
    const grouped: FrameValue = {
      __frame: true,
      columns: [
        { name: "cat", type: "string", values: ["a", "b", "a"] },
        { name: "amt", type: "number", values: [10, 20, 30] },
      ],
    };
    const sub = run(named("SUMIFS(amt, cat, @cat)", "grouptotal"), grouped) as FrameValue;
    expect(getColumn(sub, "grouptotal")!.values).toEqual([40, 20, 40]);
  });

  it("a bare column in scalar position is a LOUD per-row #SHAPE!, pointing at @", () => {
    const r = run(named("price * qty", "rev"), sales) as FrameValue;
    const v = getColumn(r, "rev")!.values[0];
    expect(isSolError(v) && v.code).toBe("#SHAPE!");
    expect(isSolError(v) && v.message).toContain("@");
  });

  it("text results infer a string column; functions dispatch normally", () => {
    const r = run(named('UPPER(@city) & "!"', "shout"), sales) as FrameValue;
    const col = getColumn(r, "shout")!;
    expect(col.type).toBe("string");
    expect(col.values).toEqual(["OSLO!", "BERGEN!", "TROMSØ!"]);
  });

  it("a blank formula passes the frame through untouched", () => {
    expect(run(named(""), sales)).toEqual(sales);
  });

  it("an unparsable formula is #VALUE!", () => {
    const r = run(named("qty *"), sales);
    expect(isSolError(r) && r.code).toBe("#VALUE!");
  });

  it("replaces an existing column when the name collides (addColumn semantics)", () => {
    const r = run(named("@qty * 2", "qty"), sales) as FrameValue;
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "price", "city"]);
    expect(getColumn(r, "qty")!.values).toEqual([4, 6, 8]);
  });

  it("a `Name (unit)` header tags the unit like Add Column", () => {
    const r = run(named("@qty * @price", "revenue (usd)"), sales) as FrameValue;
    const col = r.columns[r.columns.length - 1];
    expect(col.name).toBe("revenue");
    expect((col.unit as { display?: string } | undefined)?.display).toBe("usd");
  });
});

describe("ComputedColumnNode — the per-row contract", () => {
  it("an error cell reached by @ propagates to that row only", () => {
    const err = solError("#DIV/0!", "x");
    const f: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [1, err, 3] }],
    };
    const r = run(named("@v * 10", "out"), f) as FrameValue;
    expect(getColumn(r, "out")!.values).toEqual([10, err, 30]);
  });

  it("a null cell flows INTO the formula — ISBLANK can see it", () => {
    const f: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [1, null, 3] }],
    };
    const r = run(named('IF(ISBLANK(@v), "missing", "here")', "flag"), f) as FrameValue;
    expect(getColumn(r, "flag")!.values).toEqual(["here", "missing", "here"]);
  });

  it("a NaN result is #DOMAIN! per row; a list result is #SHAPE!", () => {
    const f: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [4, -4] }],
    };
    const sq = run(named("SQRT(@v)", "root"), f) as FrameValue;
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

  it("a column outranks a wired capture of the same name ([[C22]])", () => {
    const fn = lambdaFor("@price / SUM(price)", "");
    const r = run(named("", "share"), sales, { fn: [fn] }) as FrameValue;
    expect(getColumn(r, "share")!.values).toEqual([10 / 60, 20 / 60, 30 / 60]);
  });

});

describe("ComputedColumnNode — side inputs, row, and the output type", () => {
  it("a variable naming no column becomes a SIDE INPUT (wired value or literal default)", () => {
    const n = named("@price * (1 + taxrate)", "gross");
    // Wired: the side value is row-invariant.
    const wired = run(n, sales, { taxrate: [[0.25]] }) as FrameValue;
    expect(getColumn(wired, "gross")!.values).toEqual([12.5, 25, 37.5]);
    expect(n.sideVars).toEqual(["taxrate"]);
    // Unwired: the literal default (Expression convention: 0).
    const bare = run(named("@price * (1 + taxrate)", "gross"), sales) as FrameValue;
    expect(getColumn(bare, "gross")!.values).toEqual([10, 20, 30]);
  });

  it("a whole LIST side input aggregates like a bare column (both are whole)", () => {
    const n = named("@price / SUM(prices)", "share");
    const r = run(n, sales, { prices: [[10, 20, 30]] }) as FrameValue;
    expect(getColumn(r, "share")!.values.map((v) => (v as number).toFixed(4)))
      .toEqual(["0.1667", "0.3333", "0.5000"]);
  });

  it("ROW() is the 1-based row number, and a column named row is just a column beside it", () => {
    const r = run(named("ROW() * 10", "idx"), sales) as FrameValue;
    expect(getColumn(r, "idx")!.values).toEqual([10, 20, 30]);
    const withRowCol: FrameValue = {
      __frame: true,
      columns: [{ name: "row", type: "number", values: [7, 8, 9] }],
    };
    const both = run(named("@row * 10 + ROW()", "idx"), withRowCol) as FrameValue;
    expect(getColumn(both, "idx")!.values).toEqual([71, 82, 93]);
  });

  it("ROW() outside a computed column says where it works", () => {
    const r = compileEvaluator("ROW()")!({});
    expect(isSolError(r) && r.code).toBe("#NAME?");
  });

  it("a reserved input name refuses with #REF!", () => {
    const r = run(named("frame + 1"), sales);
    expect(isSolError(r) && r.code).toBe("#REF!");
  });

  it("auto keeps a date a date through date ± days; addAs declares what the formula can't show", () => {
    const due: FrameValue = {
      __frame: true,
      columns: [{ name: "start", type: "date", values: [46000, 46010] }],
    };
    const auto = run(named("@start + 7", "due"), due) as FrameValue;
    expect(getColumn(auto, "due")!.type).toBe("date"); // [[C118]]: a date + days is a date
    // A date can't be scaled ([[D115]] datesArePoints).
    const scaled = getColumn(run(named("@start * 1", "due"), due) as FrameValue, "due")!.values;
    expect(scaled.every((v) => isSolError(v) && v.code === "#TYPE!")).toBe(true);
    const typedNode = named("@start + 7", "due");
    typedNode.addAs = "date";
    const typed = run(typedNode, due) as FrameValue;
    expect(getColumn(typed, "due")!.type).toBe("date");
    expect(getColumn(typed, "due")!.values).toEqual([46007, 46017]);
  });

});

describe("ComputedColumnNode — bracket references, rows, and placement", () => {
  it("@[Name] is this row, [Name] the whole column — for names a variable cannot spell", () => {
    const awkward: FrameValue = {
      __frame: true,
      columns: [
        { name: "2024", type: "number", values: [100, 200] },
        { name: "Unit Price", type: "number", values: [5, 7] },
      ],
    };
    const quoted = run(named("@[2024] + @[Unit Price]", "sum"), awkward) as FrameValue;
    expect(getColumn(quoted, "sum")!.values).toEqual([105, 207]);
    const bare = run(named("[@2024] + [@[2024]]", "dbl"), awkward) as FrameValue;
    expect(getColumn(bare, "dbl")!.values).toEqual([200, 400]);
    const whole = run(named("@[Unit Price] / SUM([Unit Price])", "shr"), awkward) as FrameValue;
    expect(getColumn(whole, "shr")!.values.map((v) => (v as number).toFixed(4))).toEqual(["0.4167", "0.5833"]);
  });

  it("a bracket reference to an absent column becomes a side port reading its default, like an unknown variable", () => {
    const n = named("@[nope] + 1", "x");
    const r = run(n, sales) as FrameValue;
    expect(getColumn(r, "x")!.values).toEqual([1, 1, 1]);
    expect(n.sideVars).toContain("nope");
  });

  it("a whole column is a column, as in an Excel table: ROWS(price) is the row count", () => {
    const r = run(named("ROW() / ROWS(price)", "frac"), sales) as FrameValue;
    expect(getColumn(r, "frac")!.values).toEqual([1 / 3, 2 / 3, 1]);
    const first = run(named("INDEX(price, 1, 1) + COLUMNS(price)", "p1"), sales) as FrameValue;
    expect(getColumn(first, "p1")!.values).toEqual([11, 11, 11]);
  });

  it("After places a NEW column right after the anchor; blank appends at the end", () => {
    const n = named("@qty * @price", "revenue");
    n.stringLiterals.after = "qty";
    const r = run(n, sales) as FrameValue;
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "revenue", "price", "city"]);
  });

  it("a REPLACED column keeps its position even with After set", () => {
    const n = named("@qty * 2", "qty");
    n.stringLiterals.after = "city";
    const r = run(n, sales) as FrameValue;
    expect(r.columns.map((c) => c.name)).toEqual(["qty", "price", "city"]);
    expect(getColumn(r, "qty")!.values).toEqual([4, 6, 8]);
  });

  it("a missing After anchor refuses with #REF!", () => {
    const n = named("@qty * @price", "revenue");
    n.stringLiterals.after = "ghost";
    const r = run(n, sales);
    expect(isSolError(r) && r.code).toBe("#REF!");
    expect(isSolError(r) && r.message).toContain('"ghost"');
  });
});

describe("ComputedColumnNode — kitchen sink", () => {
  it("text functions, IF chains, and mixed builtins compose in one row formula", () => {
    const r = run(named('IF(@qty > 2, UPPER(@city), LOWER(@city)) & " #" & TEXT(ROW(), "0")', "tag"), sales) as FrameValue;
    expect(getColumn(r, "tag")!.values).toEqual(["oslo #1", "BERGEN #2", "TROMSØ #3"]);
  });


  it("a bracket read, an @ read, ROW(), and a side input all mix in one formula", () => {
    const n = named("[@qty] * @price + ROW() + base", "mix");
    const r = run(n, sales, { base: [[1000]] }) as FrameValue;
    expect(getColumn(r, "mix")!.values).toEqual([2 * 10 + 1 + 1000, 3 * 20 + 2 + 1000, 4 * 30 + 3 + 1000]);
  });
});

describe("Frame Input λ columns", () => {
  const src = (cols: Parameters<typeof frameSourceToText>[0]) => frameSourceToText(cols);
  const lambda = (expr: string, params: string) =>
    (new LambdaNode({ expr, params }).data({}) as { result: unknown }).result;

  it("a λ-bound column computes per row over the literal columns", () => {
    const n = new FrameInputNode({
      frameText: src([
        { name: "a", type: "number", cells: ["1", "2", "3"] },
        { name: "b", type: "number", cells: ["10", "20", "30"] },
        { name: "sum", type: "number", cells: [], expr: "λ1" },
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
        { name: "margin", type: "number", cells: [], expr: "λ2" }, // declared FIRST, depends on revenue
        { name: "revenue", type: "number", cells: [], expr: "λ1" },
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
        { name: "p", type: "number", cells: [], expr: "λ1" },
        { name: "q", type: "number", cells: [], expr: "λ2" },
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
        { name: "c1", type: "number", cells: [], expr: "λ1" },
        { name: "c2", type: "number", cells: [], expr: "λ2" },
      ]),
      lambdaKeys: ["fn1", "fn2"],
    });
    const out = n.data({ fn2: [lambda("ghost * 2", "ghost")] }).frame as FrameValue;
    expect(getColumn(out, "c1")!.values).toEqual([null, null]);
    const c2 = getColumn(out, "c2")!.values[0];
    expect(isSolError(c2) && c2.message).toContain("captures");
  });

  it("removing a λ row turns its columns back to Data; lambdaKeys round-trips extractInit", () => {
    const n = new FrameInputNode({
      frameText: src([
        { name: "a", type: "number", cells: ["1"] },
        { name: "c", type: "number", cells: [], expr: "λ1" },
      ]),
      lambdaKeys: ["fn1"],
    });
    const init = extractInit(n) as { lambdaKeys?: string[] };
    expect(init.lambdaKeys).toEqual(["fn1"]);
    n.removeValueInput("fn1");
    expect(n.lambdaKeys).toEqual([]);
    expect(parseFrameSource(n.frameText).find((c) => c.name === "c")!.expr).toBeUndefined();
  });
});

describe("Frame Input formula columns", () => {
  it("an expr column computes per row over the literal columns — no wiring at all", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "price", type: "number", cells: ["10", "20"] },
        { name: "qty", type: "number", cells: ["2", "3"] },
        { name: "rev", type: "number", cells: [], expr: "@price * @qty" },
        { name: "share", type: "number", cells: [], expr: "@rev / SUM(rev)" },
      ]),
    });
    const out = n.data({}).frame as FrameValue;
    expect(getColumn(out, "rev")!.values).toEqual([20, 60]);
    expect(getColumn(out, "rev")!.raw).toBeUndefined();
    expect(getColumn(out, "share")!.values).toEqual([0.25, 0.75]);
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
        { name: "half", type: "number", cells: [], expr: "@revenue / 2" },
        { name: "revenue", type: "number", cells: [], expr: "λ1" },
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

  it("a λ socket's name is callable inside a formula, with positional arguments", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "price", type: "number", cells: ["10", "20"] },
        { name: "qty", type: "number", cells: ["2", "3"] },
        { name: "c", type: "number", cells: [], expr: "λ1(@price, @qty) + 1" },
        { name: "d", type: "number", cells: [], expr: "λ2(@c)" }, // λ2 is unwired
      ]),
      lambdaKeys: ["fn1", "fn2"],
    });
    // The params name no column: a call binds them by position, not by name.
    const lam = (new LambdaNode({ expr: "x * y", params: "x, y" }).data({}) as { result: unknown }).result;
    const out = n.data({ fn1: [lam] }).frame as FrameValue;
    expect(getColumn(out, "c")!.values).toEqual([21, 61]);
    expect(getColumn(out, "d")!.values).toEqual([null, null]);
  });

  it("a λ's bare captured name that names a column reads the whole column, even ordered after a computed one ([[C22]])", () => {
    const quart = `IFS(@x > QUARTILE(x, 3), "q4", @x > QUARTILE(x, 2), "q3", @x > QUARTILE(x, 1), "q2", TRUE, "q1")`;
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "band", type: "number", cells: [], expr: "λ1" }, // declared before the column it reads
        { name: "x", type: "number", cells: [], expr: "@raw" },
        { name: "raw", type: "number", cells: ["1", "2", "3", "4", "5", "6", "7", "8"] },
      ]),
      lambdaKeys: ["fn1"],
    });
    const lam = (new LambdaNode({ expr: quart, params: "" }).data({}) as { result: unknown }).result;
    const out = n.data({ fn1: [lam] }).frame as FrameValue;
    expect(getColumn(out, "band")!.values).toEqual(["q1", "q1", "q2", "q2", "q3", "q3", "q4", "q4"]);
  });

  it("a parameter written both bare and @ is flagged: both read this row ([[C22]])", () => {
    const quart = `IFS(@x > QUARTILE(x, 3), "top", TRUE, "rest")`;
    expect(perRowParamClashes(["x"], quart)).toEqual(["x"]);
    expect(perRowParamClashes([], quart)).toEqual([]);
    expect(perRowParamClashes(["x"], "x * 2")).toEqual([]);
    expect(perRowParamClashes(["x"], "@x > QUARTILE([x], 3)")).toEqual([]);
  });

  it("a formula that keeps a date a date types the column Date; a span stays a number ([[C118]])", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "start", type: "date", cells: ["2026-03-01", "2026-03-10"] },
        { name: "days", type: "number", cells: ["5", "7"] },
        { name: "due", type: "number", cells: [], expr: "@start + @days" },
        { name: "later", type: "number", cells: [], expr: "EDATE(@due, 1)" }, // reads a COMPUTED date
        { name: "pick", type: "number", cells: [], expr: "IF(@days > 5, @due, @start)" },
        { name: "span", type: "number", cells: [], expr: "@due - @start" },
        { name: "scaled", type: "number", cells: [], expr: "@start * 2" },
        { name: "half", type: "number", cells: [], expr: "IF(@days > 0, @start)" },
      ]),
    });
    const out = n.data({}).frame as FrameValue;
    const type = (name: string) => getColumn(out, name)!.type;
    expect([type("due"), type("later"), type("pick")]).toEqual(["date", "date", "date"]);
    // Every row took its date branch, so the column is dates: its type is what it computed ([[C136]] typesKnownAfterCalc).
    expect(type("half")).toBe("date");
    expect(type("span")).toBe("number");
    expect(getColumn(out, "scaled")!.values.every((v) => isSolError(v) && v.code === "#TYPE!")).toBe(true);
    expect(getColumn(out, "span")!.values).toEqual([5, 7]);
  });

  it("a computed column's UNIT tag rides onto the derived column, like a Data column's", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "price", type: "number", cells: ["10", "20"], unit: "usd" },
        { name: "rev", type: "number", cells: [], expr: "@price * 2", unit: "usd" },
      ]),
    });
    const out = n.data({}).frame as FrameValue;
    expect(getColumn(out, "rev")!.values).toEqual([20, 40]);
    expect((getColumn(out, "rev")!.unit as { display?: string } | undefined)?.display).toBe("usd");
    // A non-numeric computed result never takes a unit tag.
    const t = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "city", type: "string", cells: ["Oslo", "Bergen"] },
        { name: "up", type: "number", cells: [], expr: "UPPER(@city)", unit: "usd" },
      ]),
    });
    expect(getColumn(t.data({}).frame as FrameValue, "up")!.unit).toBeUndefined();
  });

  it("a computed column's unit rides through INDEX and LOCKS a downstream FC", async () => {
    const { ListIndexNode } = await import("../../../src/graph/nodes/list");
    const { FormatControllerNode } = await import("../../../src/graph/nodes/formatController");
    const { isUnitCell } = await import("../../../src/graph/unitValue");
    const fi = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "price", type: "number", cells: ["10", "20"] },
        { name: "rev", type: "number", cells: [], expr: "@price * 2", unit: "usd" },
      ]),
    });
    const frame = fi.data({}).frame as FrameValue;
    const idx = new ListIndexNode();
    idx.literals.index = 2;
    idx.literals.column = 2;
    const cell = idx.data({ list: [frame] }).result;
    expect(isUnitCell(cell)).toBe(true); // the column's unit rides the extracted cell
    const fc = new FormatControllerNode({ unit: "none" });
    fc.data({ in: [cell] });
    expect(fc.forwarding).toBe(true);
    expect(fc.unit).toBe("usd");
    expect(fc.unitLocked).toBe(true);
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
  it("a ZERO-param λ reads the row via @ — capture sockets grow, columns win over them", () => {
    const lam = new LambdaNode({ expr: "@price * @qty", params: "" });
    const fn = (lam.data({}) as { result: unknown }).result;
    expect(lam.captured).toEqual(["price", "qty"]);
    const r = run(named("", "rev"), sales, { fn: [fn] }) as FrameValue;
    expect(getColumn(r, "rev")!.values).toEqual([20, 60, 120]);
  });


  it("a zero-param λ using @ still orders after the column it reads (Frame Input topo)", () => {
    const n = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "qty", type: "number", cells: ["2", "4"] },
        { name: "margin", type: "number", cells: [], expr: "λ2" }, // reads @revenue
        { name: "revenue", type: "number", cells: [], expr: "λ1" },
      ]),
      lambdaKeys: ["fn1", "fn2"],
    });
    const mk = (expr: string) => (new LambdaNode({ expr, params: "" }).data({}) as { result: unknown }).result;
    const out = n.data({ fn1: [mk("@qty * 10")], fn2: [mk("@revenue / 2")] }).frame as FrameValue;
    expect(getColumn(out, "revenue")!.values).toEqual([20, 40]);
    expect(getColumn(out, "margin")!.values).toEqual([10, 20]);
  });

  it("outside a row context, @ and the brackets answer a targeted #REF!, not a typo's #NAME?", () => {
    const r = compileEvaluator("@price + 1")!({});
    expect(isSolError(r) && r.code).toBe("#REF!");
    expect(isSolError(r) && r.message).toContain("current row");
    const c = compileEvaluator("[price]")!({});
    expect(isSolError(c) && c.code).toBe("#REF!");
    const a = compileEvaluator("@[price]")!({});
    expect(isSolError(a) && a.code).toBe("#REF!");
  });

  it("rowRefNames feeds the topo: @names and bracket references, no variables", () => {
    expect(rowRefNames("@a + [b c] * @[2024] + SUM(qty)").sort()).toEqual(["2024", "a", "b c"]);
  });
  it("a LAMBDA's parameters shadow row references however LAMBDA is cased", () => {
    expect(rowRefNames("LAMBDA(a, @a + @b)(1)")).toEqual(["b"]);
    expect(rowRefNames("lambda(a, @a + @b)(1)")).toEqual(["b"]);
  });
});

describe("@ over side values — row-aligned lists (no capture, no column)", () => {
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

  it("@[name] reads the side list per row; [name] reaches it whole — full symmetry", () => {
    const n = named("@price * @[factor]", "adj");
    run(n, sales);
    const r = run(n, sales, { factor: [[1, 2, 3]] }) as FrameValue;
    expect(getColumn(r, "adj")!.values).toEqual([10, 40, 90]);
    const w = named("@price / SUM([factor])", "norm");
    run(w, sales);
    const r2 = run(w, sales, { factor: [[1, 2, 2]] }) as FrameValue;
    expect(getColumn(r2, "norm")!.values).toEqual([2, 4, 6]);
  });

  it("a COLUMN of the same name wins over the side value, and @-misses don't fire in Frame Input", () => {
    const n = named("@qty + 0", "q2");
    const r = run(n, sales, { qty: [[100, 100, 100]] }) as FrameValue;
    expect(getColumn(r, "q2")!.values).toEqual([2, 3, 4]); // the column, not the wire
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

  it("binding a would-be side variable to a column removes its socket role", () => {
    const n = named("SUM(k) + @qty", "sum");
    n.bindings = { k: "price" };
    const r = run(n, sales) as FrameValue;
    expect(getColumn(r, "sum")!.values).toEqual([62, 63, 64]);
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
  it("an unchanged pass returns the SAME objects: λ value, CC frame", async () => {
    // The engine keeps a LAMBDA's answer while its call and captures stand (`nodes::KEEPS_ANSWER`).
    const editor = new GraphEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    const lam = new LambdaNode({ expr: "qty * k", params: "qty" });
    (lam as unknown as { literals: Record<string, number> }).literals.k = 2;
    await editor.addNode(lam as never);
    const pass = async () => { await editor.engine!.pass(undefined, undefined, false); return editor.engine!.landed(lam.id, "result"); };
    const v1 = await pass();
    expect(await pass()).toBe(v1);
    // A changed capture mints a new value.
    (lam as unknown as { literals: Record<string, number> }).literals.k = 3;
    lam.edited();
    expect(await pass()).not.toBe(v1);
    editor.dispose();

    const n = named("@price * @qty", "rev");
    const cc = await inEditor(n);
    const r1 = await cc.pass();
    expect(await cc.pass()).toBe(r1);
    // A different input frame (new identity) recomputes.
    cc.feed({ ...sales });
    const r3 = await cc.pass();
    expect(r3).not.toBe(r1);
    // A config change recomputes.
    n.stringLiterals.name = "revenue";
    n.edited();
    expect(await cc.pass()).not.toBe(r3);
    cc.dispose();
  });

  it("a changed side value or binding busts the CC memo; Frame Input computed frames are stable per (text, λ identities)", async () => {
    const n = named("@price * (1 - disc)", "net");
    const cc = await inEditor(n);
    const lit = (v: number) => { (n as unknown as { literals: Record<string, number> }).literals.disc = v; n.edited(); };
    lit(0.1);
    // The first pass grows the `disc` side socket, which is a new call; from the one after, it stands.
    await cc.pass();
    const r1 = await cc.pass();
    expect(await cc.pass()).toBe(r1);
    lit(0.2);
    const r2 = await cc.pass();
    expect(r2).not.toBe(r1);
    expect(getColumn(r2, "net")!.values).toEqual([8, 16, 24]);
    n.bindings = { disc: "qty" };
    n.edited();
    expect(await cc.pass()).not.toBe(r2);
    cc.dispose();

    const fi = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "a", type: "number", cells: ["1", "2"] },
        { name: "c", type: "number", cells: [], expr: "λ1" },
      ]),
      lambdaKeys: ["fn1"],
    });
    const lam = new LambdaNode({ expr: "a + 1", params: "a" });
    // The engine keeps Frame Input's answer while its text and its λ stand (`nodes::KEEPS_ANSWER`).
    const editor = new GraphEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    await editor.addNode(lam as never);
    await editor.addNode(fi as never);
    await editor.addConnection(new GraphConnection(lam, "result", fi, "fn1") as never);
    const pass = async () => { await editor.engine!.pass(undefined, undefined, false); return editor.engine!.landed(fi.id, "frame"); };
    const f1 = await pass();
    expect(getColumn(f1 as FrameValue, "c")!.values).toEqual([2, 3]);
    expect(await pass()).toBe(f1);
    // A new λ (an edit upstream) recomputes.
    lam.expr = "a + 2";
    lam.edited();
    expect(await pass()).not.toBe(f1);
    editor.dispose();
  });
});

describe("persistence", () => {
  it("extractInit round-trips expr and the column name", () => {
    const n = named("qty * price", "revenue");
    const init = extractInit(n) as { expr?: string };
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

describe("wired blanks, picked columns at @, λ params", () => {
  it("a WIRED BLANK side value is unknown: blank rows, never 0; unwired keeps the default", () => {
    const n = named("@qty * rate", "amt");
    const blank = run(n, sales, { rate: [null] }) as FrameValue;
    expect(getColumn(blank, "amt")!.values).toEqual([null, null, null]);
    const viaAt = run(named("@qty * @rate", "amt"), sales, { rate: [null] }) as FrameValue;
    expect(getColumn(viaAt, "amt")!.values).toEqual([null, null, null]);
  });

  it("@x reads the picked column's this-row cell and grows no side port", () => {
    const n = named("@x * 2", "dbl");
    n.bindings = { x: "qty" };
    const r = run(n, sales) as FrameValue;
    expect(getColumn(r, "dbl")!.values).toEqual([4, 6, 8]);
    expect(n.sideVars).toEqual([]);
    const gone = named("@x * 2", "dbl");
    gone.bindings = { x: "vanished" };
    const e = run(gone, sales);
    expect(isSolError(e) && e.message).toBe('No column "vanished" to bind "x" to');
  });
});
