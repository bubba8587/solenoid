// [[script-sandbox#Script runs your own code, and only typed values come out]], [[script-sandbox#The source]], [[script-sandbox#One call]], [[script-sandbox#The arguments]],
// [[script-sandbox#The result]], [[C23]] calcModes
import { solDate } from "../../../src/graph/dateValue";
import { describe, it, expect } from "vitest";
import { ScriptNode, DEFAULT_SCRIPT } from "../../../src/graph/nodes/script";
import { scriptParams, toClonable, invokeScript, scriptIsVolatile } from "../../../src/graph/nodes/scriptRun";
import { coerceScriptResult } from "../../../src/graph/nodes/scriptCoerce";
import { throughBoundary } from "../boundaryKit";
import { isSolError, solError } from "../../../src/graph/errorValue";
import { extractInit } from "../../../src/graph/nodeInit";
import { pasteCopy } from "../fixtures/pasteCopy";
import { jsDateToSerial } from "../../../src/graph/nodes/dateSerial";
import type { View } from "../../../src/graph/view";
import { GraphEditor } from "../../../src/graph/graphEditor";
import { DataflowEngine } from "../../../src/graph/dataflowEngine";
import type { Schemes } from "../../../src/graph/schemes";
import { processGraph, requestRecalc, setEditorRefs } from "../../../src/graph/process";

const code = (v: unknown) => (isSolError(v) ? v.code : v);

/** A Script card alone in an editor, through a real pass: its result socket's type after the Type Settle. */
async function passed(expr: string) {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
  const node = new ScriptNode({ expr });
  await editor.addNode(node as unknown as Schemes["Node"]);
  await processGraph();
  return { node, typed: () => (node.outputs.result!.socket as unknown as { dataType: string }).dataType };
}

async function run(expr: string, inputs: Record<string, unknown[]> = {}, init: { stringLiterals?: Record<string, string>; literalKinds?: Record<string, "number" | "string" | "date" | "logical"> } = {}) {
  const node = new ScriptNode({ expr, ...init });
  throughBoundary(node as unknown as Parameters<typeof throughBoundary>[0]);
  const out = await (node.data(inputs) as Promise<{ result: unknown }>);
  return { result: out.result, node };
}

describe("scriptParams — the function head declares the inputs", () => {
  it("reads arrow, bare-arrow, function and async forms", () => {
    expect(scriptParams("(a, b) => a + b")).toEqual({ params: ["a", "b"] });
    expect(scriptParams("x => x")).toEqual({ params: ["x"] });
    expect(scriptParams("function (rows, n) { return n }")).toEqual({ params: ["rows", "n"] });
    expect(scriptParams("async (u) => u")).toEqual({ params: ["u"] });
    expect(scriptParams("() => 1")).toEqual({ params: [] });
    expect(scriptParams("")).toEqual({ params: [] });
  });
  it("refuses a non-function, a destructured/defaulted parameter, a keyword and a duplicate", () => {
    expect(scriptParams("x * 2")).toHaveProperty("error");
    expect(scriptParams("({a}) => a")).toHaveProperty("error");
    expect(scriptParams("(a = 1) => a")).toHaveProperty("error");
    expect(scriptParams("(class) => 1")).toHaveProperty("error");
    expect(scriptParams("(a, a) => a")).toHaveProperty("error");
  });
});

describe("scriptIsVolatile — random/clock sources earn the Recalculate button", () => {
  it("spots the volatile globals", () => {
    expect(scriptIsVolatile("() => Math.random()")).toBe(true);
    expect(scriptIsVolatile("() => Date.now()")).toBe(true);
    expect(scriptIsVolatile("() => new Date()")).toBe(true);
    expect(scriptIsVolatile("() => crypto.randomUUID()")).toBe(true);
    expect(scriptIsVolatile("() => performance.now()")).toBe(true);
  });
  it("a pure script, and a Date built FROM arguments, stay quiet", () => {
    expect(scriptIsVolatile("(x) => x * 2")).toBe(false);
    expect(scriptIsVolatile("(y) => new Date(Date.UTC(y, 0, 1))")).toBe(false);
  });
});

describe("ScriptNode — sockets follow the parameters", () => {
  it("a new node carries the default script and its one input", () => {
    const n = new ScriptNode();
    expect(n.expr).toBe(DEFAULT_SCRIPT);
    expect(Object.keys(n.inputs)).toEqual(["x"]);
    expect(n.outputs.result).toBeDefined();
  });
  it("_rebuild reports added and removed names, keeping survivors", () => {
    const n = new ScriptNode({ expr: "(a, b) => a" });
    n.expr = "(b, c) => b";
    const d = n._rebuild();
    expect(d.added).toEqual(["c"]);
    expect(d.removed).toEqual(["a"]);
    expect(n.varNames).toEqual(["b", "c"]);
  });
});

describe("ScriptNode.data — values in", () => {
  it("scalars, lists and matrices arrive as plain JS values", async () => {
    expect((await run("(a, b) => a * b", { a: [3], b: [4] })).result).toBe(12);
    expect((await run("(xs) => xs.map((x) => x * 2)", { xs: [[1, 2, 3]] })).result).toEqual([2, 4, 6]);
    expect((await run("(m) => m[1][0]", { m: [[[1, 2], [3, 4]]] })).result).toBe(3);
  });
  it("a wired blank is null; unwired and untyped is undefined", async () => {
    expect((await run("(x) => x === null", { x: [null] })).result).toBe(true);
    expect((await run("(x) => x === undefined")).result).toBe(true);
  });
  it("an unwired parameter takes the keyed literal, read as its slot's kind", async () => {
    expect((await run("(x) => x + 1", {}, { stringLiterals: { x: "41" } })).result).toBe(42);
    expect((await run("(s) => s.toUpperCase()", {}, { stringLiterals: { s: "hi" }, literalKinds: { s: "string" } })).result).toBe("HI");
    expect((await run("(x) => x", {}, { stringLiterals: { x: "hi" } })).result).toMatchObject({ code: "#TYPE!" });
  });
  it("a per-cell error in any input propagates without running the script", async () => {
    const bad = solError("#DIV/0!", "x");
    const { result } = await run("(xs) => 1", { xs: [[1, bad, 3]] });
    expect(code(result)).toBe("#DIV/0!");
  });
});

describe("a Script card's source runs only in the sandbox", () => {
  it("building the card, as loading a document does, parses the source and never runs it", () => {
    const g = globalThis as { __scriptRan?: number };
    delete g.__scriptRan;
    const n = new ScriptNode({ expr: "x => x, (globalThis.__scriptRan = 1), x => x" });
    expect(g.__scriptRan).toBeUndefined();
    expect(n.varNames).toEqual(["x"]);
    new ScriptNode({ expr: "(x) => x)(globalThis.__scriptRan = 2" });
    expect(g.__scriptRan).toBeUndefined();
  });
});

describe("ScriptNode.data — the result is folded onto the value model", () => {
  it("empty source is blank; a broken source is #SYNTAX!; a throw is #VALUE! with its message", async () => {
    expect((await run("")).result).toBeNull();
    expect(code((await run("(x) => {")).result)).toBe("#SYNTAX!");
    expect(code((await run("x * 2")).result)).toBe("#SYNTAX!");
    const { result, node } = await run("(x) => x.map(1)", { x: [[1]] });
    expect(code(result)).toBe("#VALUE!");
    expect(node.cachedError).toMatch(/TypeError/);
  });
  it("values keep their own kinds; blanks and error cells pass through", async () => {
    expect((await run("() => [1, 2, 3]")).result).toEqual([1, 2, 3]);
    const d = new Date(Date.UTC(2026, 0, 15));
    expect((await run("() => new Date(Date.UTC(2026, 0, 15))")).result).toEqual(solDate(jsDateToSerial(d)));
    const r = (await run("() => [0 / 0, null, 2]")).result as unknown[];
    expect(r.map(code)).toEqual(["#DOMAIN!", null, 2]);
  });
  it("the result socket takes the type of the value it carried, and keeps it through an empty answer ([[socket-lattice#An empty answer keeps the type it last carried; before any, its source's declared type]])", async () => {
    const { node, typed } = await passed("() => 5");
    expect(typed()).toBe("numlist");
    for (const [expr, want] of [
      ["() => []", "numlist"],
      ["() => ['a', 'b']", "strcombo"],
      ["() => new Date(Date.UTC(2026, 0, 1))", "datecombo"],
      ["() => true", "logicalcombo"],
      ["() => [[1, 2], [3, 4]]", "table"],
      ["() => [[true, false], [false, true]]", "logicaltable"],
      ["() => [{ n: 1 }]", "frame"],
      ["() => [{ region: 'EU', months: [1, 2] }]", "cube"],
    ] as const) {
      node.expr = expr;
      node._rebuild();
      node.edited();
      await processGraph();
      expect(typed(), expr).toBe(want);
    }
  });
  it("Solenoid.date lifts a serial (or a list of them) to dates; a non-serial is #TYPE!", async () => {
    const { result } = await run("(d) => Solenoid.date(d + 30)", { d: [46000] });
    expect(result).toEqual(solDate(46030));
    const list = await run("(d) => Solenoid.date([d, d + 7])", { d: [46000] });
    expect(list.result).toEqual([solDate(46000), solDate(46007)]);
    expect(code((await run("() => Solenoid.date('soon')")).result)).toBe("#TYPE!");
  });
  it("containers are single-typed, uniformly: a mixed list OR mixed rows are #AMBIGUOUS!", async () => {
    expect(code((await run("() => [1, 'a']")).result)).toBe("#AMBIGUOUS!");
    expect(code((await run("() => [['year', 1], [2, 3]]")).result)).toBe("#AMBIGUOUS!");
    const ok = await run("() => [[1, 2], [3, 4]]");
    expect(ok.result).toEqual([[1, 2], [3, 4]]);
    // Homogeneous booleans are not "mixed" — they ride the wildcard whole.
  });
  it("{name: value} rows become a FRAME with typed columns; a single object is one row", async () => {
    const { result } = await run("() => [{ n: 1, who: 'ada' }, { n: 2, who: 'lin' }]");
    const f = result as { __frame: true; columns: Array<{ name: string; type: string; values: unknown[] }> };
    expect(f.__frame).toBe(true);
    expect(f.columns.map((c) => [c.name, c.type])).toEqual([["n", "number"], ["who", "string"]]);
    expect(f.columns[1].values).toEqual(["ada", "lin"]);
    // A missing key is a blank cell; a Date-valued column types as date.
    const g = (await run("() => [{ a: 1 }, { a: 2, b: new Date(Date.UTC(2026, 0, 1)) }]")).result as { columns: Array<{ name: string; type: string; values: unknown[] }> };
    expect(g.columns.map((c) => [c.name, c.type])).toEqual([["a", "number"], ["b", "date"]]);
    expect(g.columns[1].values[0]).toBeNull();
    const one = (await run("() => ({ total: 9 })")).result as { __frame: true; columns: Array<{ values: unknown[] }> };
    expect(one.__frame).toBe(true);
    expect(one.columns[0].values).toEqual([9]);
  });
  it("a frame column mixing types is #AMBIGUOUS!; rows mixed with plain values are #SHAPE!", async () => {
    expect(code((await run("() => [{ a: 1 }, { a: 'x' }]")).result)).toBe("#AMBIGUOUS!");
    expect(code((await run("() => [{ a: 1 }, 2]")).result)).toBe("#SHAPE!");
  });
  it("rows whose cells nest rows or lists become a CUBE", async () => {
    const { result } = await run(
      "() => [{ region: 'EU', months: [1, 2], detail: [{ m: 1, sales: 3 }] }]",
    );
    const c = result as { __cube: true; depth: number; columns: Array<{ name: string; cells: unknown[] }> };
    expect(c.__cube).toBe(true);
    expect(c.columns.map((x) => x.name)).toEqual(["region", "months", "detail"]);
    expect(c.columns[1].cells[0]).toEqual([1, 2]);
    const detail = c.columns[2].cells[0] as { __frame: true; columns: Array<{ name: string }> };
    expect(detail.__frame).toBe(true);
    expect(detail.columns.map((x) => x.name)).toEqual(["m", "sales"]);
  });
});

describe("ScriptNode.data — frames and cubes in", () => {
  const frame = {
    __frame: true,
    columns: [
      { name: "city", type: "string", values: ["Oslo", "Riga"] },
      { name: "sales", type: "number", values: [10, 7] },
    ],
  };
  it("a script can round-trip a frame: read rows, return transformed rows", async () => {
    const { result } = await run("(f) => f.map((r) => ({ city: r.city, big: r.sales * 100 }))", { f: [frame] });
    const out = result as { __frame: true; columns: Array<{ name: string; type: string; values: unknown[] }> };
    expect(out.columns.map((c) => [c.name, c.type])).toEqual([["city", "string"], ["big", "number"]]);
    expect(out.columns[1].values).toEqual([1000, 700]);
  });
  it("an error cell inside a frame propagates without running the script", async () => {
    const bad = {
      __frame: true,
      columns: [{ name: "x", type: "number", values: [1, solError("#DIV/0!", "boom")] }],
    };
    expect(code((await run("(f) => f.length", { f: [bad] })).result)).toBe("#DIV/0!");
  });
  it("a cube arrives as rows with nested rows/lists in cells", async () => {
    const cube = {
      __cube: true, depth: 1,
      columns: [
        { name: "k", cells: ["a", "b"] },
        { name: "vs", cells: [[1, 2], [3]] },
      ],
    };
    const { result } = await run("(c) => c.map((r) => r.k + r.vs.length).join('')", { c: [cube] });
    expect(result).toBe("a2b1");
  });
  it("a lambda has no script form and errors before the run", async () => {
    const lam = { __lambda: true, params: ["x"], fn: () => 1, expr: "x" };
    const r = (await run("(g) => g", { g: [lam] })).result;
    expect(code(r)).toBe("#TYPE!");
  });
  it("functions and unclonables are #TYPE!; deeper or mixed nesting is #SHAPE!", async () => {
    expect(code((await run("() => () => 1")).result)).toBe("#TYPE!");
    expect(code((await run("() => new Map()")).result)).toBe("#TYPE!");
    expect(code((await run("() => [1, [2]]")).result)).toBe("#SHAPE!");
    expect(code((await run("() => [[[1]]]")).result)).toBe("#SHAPE!");
  });
  it("rows pad to the widest with null, as every broadcaster pads", async () => {
    expect((await run("() => [[1], [2, 3]]")).result).toEqual([[1, null], [2, 3]]);
  });
  it("cachedResult mirrors the result and the error message clears on success", async () => {
    const { node } = await run("(x) => x + 1", { x: [1] });
    expect(node.cachedResult).toBe(2);
    expect(node.cachedError).toBeNull();
  });
});

describe("evaluator + coercer, standalone", () => {
  it("toClonable marks what postMessage cannot carry and flattens typed arrays", () => {
    expect(toClonable(() => 1)).toEqual({ __unclonable: "function" });
    expect(toClonable(new Float64Array([1, 2]))).toEqual([1, 2]);
    expect(toClonable([1, new Map()])).toEqual([1, { __unclonable: "Map" }]);
  });
  it("invokeScript awaits an async function", async () => {
    expect(await invokeScript("async (x) => x * 2", [2])).toEqual({ ok: true, value: 4 });
  });
  it("a BigInt outside the safe range is #OVERFLOW!; in range it is a number", () => {
    expect(code(coerceScriptResult(2n ** 60n))).toBe("#OVERFLOW!");
    expect(coerceScriptResult(7n)).toBe(7);
  });
});

describe("persistence", () => {
  it("extractInit round-trips source and both literal maps", () => {
    const n = new ScriptNode({ expr: "(a, b) => a", stringLiterals: { a: "2", b: "q" }, literalKinds: { b: "string" } });
    n.label = "Mine";
    const init = extractInit(n) as Record<string, unknown>;
    const back = new ScriptNode(init as ConstructorParameters<typeof ScriptNode>[0]);
    expect(back.expr).toBe("(a, b) => a");
    expect(back.label).toBe("Mine");
    expect(init.a).toBeUndefined();
    expect(Object.keys(back.inputs)).toEqual(["a", "b"]);
  });

  it("a parameter named like an init field keeps both through the paste path", async () => {
    const n = new ScriptNode({ expr: "(label) => label", stringLiterals: { label: "7" } });
    n.label = "Mine";
    expect(extractInit(n).label).toBe("Mine");
    const back = await pasteCopy(n);
    expect(back.label).toBe("Mine");
    expect(back.stringLiterals.label).toBe("7");
  });
});

describe("review pins: comments before the head; the inline path clones its arguments", () => {
  it("a leading line or block comment does not hide the function", () => {
    expect(scriptParams("// doubles\n(x) => x * 2")).toEqual({ params: ["x"] });
    expect(scriptParams("/* doubles */ function f(a, b) { return a + b }")).toEqual({ params: ["a", "b"] });
  });

  it("a script that mutates its argument never edits the caller's array", async () => {
    const { executeScript } = await import("../../../src/graph/scriptExecutor");
    const xs = [1, 2, 3];
    const out = await executeScript("(xs) => { xs.push(9); return xs.length }", [xs]);
    expect(out.ok && out.value).toBe(4);
    expect(xs).toEqual([1, 2, 3]);
  });
});

describe("a date goes into a script as a Date ([[C137]] datesNeverSerials)", () => {
  it("a date column reads as Date objects, and passes back out as a date column", async () => {
    const frame = { __frame: true, columns: [{ name: "due", type: "date", values: [46000] }, { name: "qty", type: "number", values: [3] }] };
    const seen = await run("(rows) => rows.every((r) => r.due instanceof Date && typeof r.qty === 'number')", { rows: [frame] });
    expect(seen.result).toBe(true);
    const back = (await run("(rows) => rows", { rows: [frame] })).result as { columns: Array<{ type: string; values: unknown[] }> };
    expect(back.columns.map((c) => [c.type, c.values[0]])).toEqual([["date", 46000], ["number", 3]]);
  });

  it("a date-typed input reads as a Date and comes back a date", async () => {
    const node = new ScriptNode({ expr: "(d) => d" });
    (node.inputs.d!.socket as unknown as { setType(t: string): void }).setType("date");
    throughBoundary(node as unknown as Parameters<typeof throughBoundary>[0]);
    const out = await (node.data({ d: [solDate(46000)] }) as Promise<{ result: unknown }>);
    expect(out.result).toEqual(solDate(46000));
  });
});

describe("a volatile Script holds its result until F9 ([[C23]] calcModes)", () => {
  async function held(expr: string, stringLiterals: Record<string, string>) {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
    const node = new ScriptNode({ expr, stringLiterals });
    await editor.addNode(node as unknown as Schemes["Node"]);
    await processGraph();
    return node;
  }

  it("keeps the draw through a plain recalculation with the same inputs", async () => {
    const node = await held("(x) => x + Math.random()", { x: "1" });
    const first = node.cachedResult;
    expect(typeof first).toBe("number");
    await processGraph(node.id);
    expect(node.cachedResult).toBe(first);
    await processGraph(undefined, undefined, { force: true });
    expect(node.cachedResult).toBe(first);
  });

  it("draws anew on F9, which the Recalculate button sends", async () => {
    const node = await held("(x) => x + Math.random()", { x: "1" });
    const first = node.cachedResult;
    await requestRecalc();
    expect(node.cachedResult).not.toBe(first);
    expect(Math.floor(node.cachedResult as number)).toBe(1);
  });

  it("runs again when an input or the code changes", async () => {
    const node = await held("(x) => x + Math.random()", { x: "1" });
    node.stringLiterals = { x: "5" };
    await processGraph(node.id);
    expect(Math.floor(node.cachedResult as number)).toBe(5);
    node.expr = "(x) => x + 10 + Math.random()";
    node._rebuild();
    await processGraph(node.id);
    expect(Math.floor(node.cachedResult as number)).toBe(15);
  });

  it("holds a clock reading the same way", async () => {
    const node = await held("() => Date.now() + Math.random()", {});
    const first = node.cachedResult;
    await processGraph(node.id);
    expect(node.cachedResult).toBe(first);
  });
});
