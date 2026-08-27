import { describe, it, expect } from "vitest";
import { ScriptNode, DEFAULT_SCRIPT } from "./script";
import { scriptParams, toClonable, invokeScript } from "./scriptRun";
import { coerceScriptResult } from "./scriptCoerce";
import { wrapNodeData } from "../coerceInputs";
import { isSolError, solError, type SolError } from "../errorValue";
import { extractInit } from "../copyPaste";
import { jsDateToSerial } from "./dateSerial";
import type { ResultType } from "./shared";

const code = (v: unknown) => (isSolError(v) ? v.code : v);

async function run(expr: string, inputs: Record<string, unknown[]> = {}, init: { resultAs?: ResultType; literals?: Record<string, number>; stringLiterals?: Record<string, string> } = {}) {
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
  it("auto keeps numbers, text and booleans, and turns a Date into a serial", async () => {
    expect((await run("() => [1, 'a', true]")).result).toEqual([1, "a", true]);
    const d = new Date(Date.UTC(2026, 0, 15));
    expect((await run("() => new Date(Date.UTC(2026, 0, 15))")).result).toBe(jsDateToSerial(d));
  });
  it("number: NaN is #DOMAIN! per cell, text is #TYPE! per cell, booleans ride the bridge", async () => {
    const r = (await run("() => [0 / 0, 'x', true, null, 2]", {}, { resultAs: "number" })).result as unknown[];
    expect(r.map(code)).toEqual(["#DOMAIN!", "#TYPE!", 1, null, 2]);
  });
  it("text: a number is #TYPE!, telling the author to use String()", async () => {
    const r = (await run("() => 5", {}, { resultAs: "text" })).result as SolError;
    expect(r.code).toBe("#TYPE!");
    expect(r.message).toMatch(/String\(\)/);
  });
  it("date: a serial or a Date passes, text and booleans do not", async () => {
    expect((await run("() => 46000", {}, { resultAs: "date" })).result).toBe(46000);
    const r = (await run("() => ['2026-01-01', true]", {}, { resultAs: "date" })).result as unknown[];
    expect(r.map(code)).toEqual(["#TYPE!", "#TYPE!"]);
  });
  it("functions and objects are #TYPE!; deeper or mixed nesting is #SHAPE!", async () => {
    expect(code((await run("() => () => 1")).result)).toBe("#TYPE!");
    expect(code((await run("() => ({ a: 1 })")).result)).toBe("#TYPE!");
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
  it("a BigInt outside the safe range is #OVERFLOW!", () => {
    expect(code(coerceScriptResult(2n ** 60n, "number"))).toBe("#OVERFLOW!");
    expect(coerceScriptResult(7n, "number")).toBe(7);
  });
});

describe("persistence", () => {
  it("extractInit round-trips source, result type and both literal maps", () => {
    const n = new ScriptNode({ expr: "(a, b) => a", resultAs: "text", literals: { a: 2 }, stringLiterals: { b: "q" } });
    n.label = "Mine";
    const init = extractInit(n) as Record<string, unknown>;
    const back = new ScriptNode(init as ConstructorParameters<typeof ScriptNode>[0]);
    expect(back.expr).toBe("(a, b) => a");
    expect(back.resultAs).toBe("text");
    expect(back.label).toBe("Mine");
    expect(init.a).toBe(2); // literals spread flat into the snapshot; the clone path copies the map
    expect(Object.keys(back.inputs)).toEqual(["a", "b"]);
  });
});
