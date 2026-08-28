import { describe, it, expect } from "vitest";
import { ScriptNode, DEFAULT_SCRIPT } from "./script";
import { scriptParams, toClonable, invokeScript, scriptIsVolatile } from "./scriptRun";
import { coerceScriptResult } from "./scriptCoerce";
import { wrapNodeData } from "../coerceInputs";
import { isSolError, solError } from "../errorValue";
import { extractInit } from "../copyPaste";
import { jsDateToSerial } from "./dateSerial";

const code = (v: unknown) => (isSolError(v) ? v.code : v);

async function run(expr: string, inputs: Record<string, unknown[]> = {}, init: { literals?: Record<string, number>; stringLiterals?: Record<string, string> } = {}) {
  const node = new ScriptNode({ expr, ...init });
  wrapNodeData(node as unknown as Parameters<typeof wrapNodeData>[0]);
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
  it("an unwired parameter takes the typed literal, number or text", async () => {
    expect((await run("(x) => x + 1", {}, { literals: { x: 41 } })).result).toBe(42);
    expect((await run("(s) => s.toUpperCase()", {}, { stringLiterals: { s: "hi" } })).result).toBe("HI");
  });
  it("a per-cell error in any input propagates without running the script", async () => {
    const bad = solError("#DIV/0!", "x");
    const { result } = await run("(xs) => 1", { xs: [[1, bad, 3]] });
    expect(code(result)).toBe("#DIV/0!");
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
    expect((await run("() => new Date(Date.UTC(2026, 0, 15))")).result).toBe(jsDateToSerial(d));
    const r = (await run("() => [0 / 0, null, 2]")).result as unknown[];
    expect(r.map(code)).toEqual(["#DOMAIN!", null, 2]);
  });
  it("the result socket family follows the value (no toggle)", async () => {
    expect((await run("() => 5")).node.lastResultFamily).toBe("number");
    expect((await run("() => ['a', 'b']")).node.lastResultFamily).toBe("text");
    expect((await run("() => new Date(Date.UTC(2026, 0, 1))")).node.lastResultFamily).toBe("date");
    expect((await run("() => true")).node.lastResultFamily).toBe("auto"); // no boolean result socket
    // A vote-less result keeps the settled family rather than flapping to auto.
    const { node } = await run("() => 5");
    await (node.data({}) as Promise<unknown>); // still 5 → number
    node.expr = "() => []";
    node._rebuild();
    await (node.data({}) as Promise<unknown>);
    expect(node.lastResultFamily).toBe("number");
  });
  it("Solenoid.date lifts a serial (or a list of them) to dates; a non-serial is #TYPE!", async () => {
    const { result, node } = await run("(d) => Solenoid.date(d + 30)", { d: [46000] });
    expect(result).toBe(46030);
    expect(node.lastResultFamily).toBe("date");
    const list = await run("(d) => Solenoid.date([d, d + 7])", { d: [46000] });
    expect(list.result).toEqual([46000, 46007]);
    expect(list.node.lastResultFamily).toBe("date");
    expect(code((await run("() => Solenoid.date('soon')")).result)).toBe("#TYPE!");
  });
  it("containers are single-typed, uniformly: a mixed list OR mixed rows are #AMBIGUOUS!", async () => {
    expect(code((await run("() => [1, 'a']")).result)).toBe("#AMBIGUOUS!");
    expect(code((await run("() => [['year', 1], [2, 3]]")).result)).toBe("#AMBIGUOUS!");
    const ok = await run("() => [[1, 2], [3, 4]]");
    expect(ok.result).toEqual([[1, 2], [3, 4]]);
    expect(ok.node.lastResultFamily).toBe("number");
    // Homogeneous booleans are not "mixed" — they ride the wildcard whole.
    expect((await run("() => [[true, false], [false, true]]")).node.lastResultFamily).toBe("auto");
  });
  it("{name: value} rows become a FRAME with typed columns; a single object is one row", async () => {
    const { result, node } = await run("() => [{ n: 1, who: 'ada' }, { n: 2, who: 'lin' }]");
    const f = result as { __frame: true; columns: Array<{ name: string; type: string; values: unknown[] }> };
    expect(f.__frame).toBe(true);
    expect(f.columns.map((c) => [c.name, c.type])).toEqual([["n", "number"], ["who", "string"]]);
    expect(f.columns[1].values).toEqual(["ada", "lin"]);
    expect(node.lastResultFamily).toBe("frame");
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
    const { result, node } = await run(
      "() => [{ region: 'EU', months: [1, 2], detail: [{ m: 1, sales: 3 }] }]",
    );
    const c = result as { __cube: true; depth: number; columns: Array<{ name: string; cells: unknown[] }> };
    expect(c.__cube).toBe(true);
    expect(node.lastResultFamily).toBe("cube");
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
  it("a frame arrives as rows of {name: value} — the mirror of the output form", async () => {
    const { result } = await run("(f) => f.map((r) => r.city + ':' + r.sales).join(' ')", { f: [frame] });
    expect(result).toBe("Oslo:10 Riga:7");
  });
  it("a script can round-trip a frame: read rows, return transformed rows", async () => {
    const { result, node } = await run("(f) => f.map((r) => ({ city: r.city, big: r.sales * 100 }))", { f: [frame] });
    const out = result as { __frame: true; columns: Array<{ name: string; type: string; values: unknown[] }> };
    expect(out.columns.map((c) => [c.name, c.type])).toEqual([["city", "string"], ["big", "number"]]);
    expect(out.columns[1].values).toEqual([1000, 700]);
    expect(node.lastResultFamily).toBe("frame");
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
    expect(code(coerceScriptResult(2n ** 60n).value)).toBe("#OVERFLOW!");
    expect(coerceScriptResult(7n)).toEqual({ value: 7, family: "number" });
  });
});

describe("persistence", () => {
  it("extractInit round-trips source and both literal maps", () => {
    const n = new ScriptNode({ expr: "(a, b) => a", literals: { a: 2 }, stringLiterals: { b: "q" } });
    n.label = "Mine";
    const init = extractInit(n) as Record<string, unknown>;
    const back = new ScriptNode(init as ConstructorParameters<typeof ScriptNode>[0]);
    expect(back.expr).toBe("(a, b) => a");
    expect(back.label).toBe("Mine");
    expect(init.a).toBe(2); // literals spread flat into the snapshot; the clone path copies the map
    expect(Object.keys(back.inputs)).toEqual(["a", "b"]);
  });
});
