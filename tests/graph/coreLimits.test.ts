// [[C130]] rustCore, [[C120]] linearWork: inputs a user can type or wire that once trapped the module (a stack overflow,
// an index past a ragged row, an unbounded allocation), hung it, or took quadratic time, each now a prompt answer.
import { it, expect } from "vitest";
import { evaluateOnCore, callOnCore } from "../../src/graph/coreValues";
import { isSolError } from "../../src/graph/errorValue";
import { EtsForecastNode } from "../../src/graph/nodes/stats";

const code = (v: unknown) => (isSolError(v) ? v.code : v);
const timed = (f: () => unknown) => {
  const t0 = performance.now();
  const v = f();
  return { v, ms: performance.now() - t0 };
};

it("a formula nested past the parser's depth is #SYNTAX!; a long flat one still answers", () => {
  expect(code(evaluateOnCore("(".repeat(2000) + "1" + ")".repeat(2000), {}))).toBe("#SYNTAX!");
  expect(code(evaluateOnCore(Array(3500).fill("1").join("+"), {}))).toBe("#SYNTAX!");
  expect(code(evaluateOnCore("ABS(".repeat(1500) + "1" + ")".repeat(1500), {}))).toBe("#SYNTAX!");
  expect(code(evaluateOnCore("-".repeat(3000) + "1", {}))).toBe("#SYNTAX!");
  expect(evaluateOnCore(Array(300).fill("1").join("+"), {})).toBe(300);
});

it("a LAMBDA that keeps calling itself is #OVERFLOW!; one with a base case still recurses", () => {
  expect(code(evaluateOnCore("LAMBDA(g,g(g))(LAMBDA(g,g(g)))", {}))).toBe("#OVERFLOW!");
  const count = "LAMBDA(g,k,IF(k=0,0,1+g(g,k-1)))";
  expect(evaluateOnCore(`${count}(${count}, 100)`, {})).toBe(100);
  expect(code(evaluateOnCore(`${count}(${count}, 100000)`, {}))).toBe("#OVERFLOW!");
});

it("MAKEARRAY with a side that isn't a number builds nothing rather than a billion rows", () => {
  const { v, ms } = timed(() => evaluateOnCore("MAKEARRAY(1E9, SEQUENCE(2), LAMBDA(r, c, 1))", {}));
  expect(ms).toBeLessThan(2000);
  expect(Array.isArray(v) ? v.length : code(v)).not.toBe(1e9);
});

it("a ragged matrix is #SHAPE!, not an index past its short row", () => {
  for (const name of ["MMULT", "MDETERM", "MINVERSE", "MATRIXRANK", "TRACE"])
    expect(code(callOnCore(name, name === "MMULT" ? [[[1, 2], [3]], [[1], [2]]] : [[[1, 2], [3]]])), name).toBe("#SHAPE!");
});

it("FISHEREXACT and BINOM.DIST.RANGE past 2^53 answer instead of looping", () => {
  expect(timed(() => evaluateOnCore("FISHEREXACT(1E16, 1, 1, 1)", {})).ms).toBeLessThan(2000);
  expect(timed(() => evaluateOnCore("BINOM.DIST.RANGE(1E16, 0.5, 1E16 - 4, 1E16)", {})).ms).toBeLessThan(2000);
});

it("PRICE and YIELD with a far maturity don't walk every coupon in between", () => {
  const { v, ms } = timed(() => evaluateOnCore("PRICE(1, 2958465, 0.05, 0.06, 100, 2)", {}));
  expect(ms).toBeLessThan(2000);
  expect(typeof v).toBe("number");
  expect(timed(() => evaluateOnCore("YIELD(1, 1E8, 0.05, 90, 100, 2)", {})).ms).toBeLessThan(2000);
});

it("the ETS Forecast card caps its horizon at the generated-values limit", () => {
  const n = new EtsForecastNode();
  expect(() => n.data({ values: [[1, 2, 3, 4, 5, 6, 7, 8]], horizon: [1e8] })).toThrow(/exceeds the 1000000 element limit/);
});

it("FINDPEAKS with a distance walks each peak's neighbours, not every peak", () => {
  const xs = Array.from({ length: 100_000 }, (_, i) => Math.sin(i * 2.1) + Math.sin(i * 0.001));
  const { v, ms } = timed(() => evaluateOnCore("FINDPEAKS(xs, , 3)", { xs }));
  expect(ms).toBeLessThan(2000);
  expect(Array.isArray(v) && v.length).toBeGreaterThan(1000);
});

it("a list of lookups indexes the keys once instead of scanning them per lookup", () => {
  const keys = Array.from({ length: 50_000 }, (_, i) => `ID-${i}`);
  const vals = keys.map((_, i) => i);
  const wanted = keys.map((k) => k.toLowerCase()).reverse();
  const { v, ms } = timed(() => evaluateOnCore("XLOOKUP(w, k, v)", { w: wanted, k: keys, v: vals }));
  expect(ms).toBeLessThan(3000);
  expect((v as number[])[0]).toBe(49_999);
  // Twenty lookups take the index; a search from the end finds the last match, text without case.
  const w = ["ID-1", "id-7", "nope", 3, NaN, ...Array(15).fill("ID-19")];
  for (const [mode, want] of [[-1, [6, 12, "#N/A", 4, "#N/A"]], [1, [1, 2, "#N/A", 4, "#N/A"]]] as const) {
    const m = evaluateOnCore(`XMATCH(w, k, 0, ${mode})`, { w, k: ["ID-1", "ID-7", "id-1", 3, ...keys.slice(0, 20)] }) as unknown[];
    expect(m.slice(0, 5).map(code)).toEqual(want);
  }
});

it("the Lookup card over a Cube reads its key column once for a list of lookups", async () => {
  const { XLookupNode } = await import("../../src/graph/nodes/frame");
  const ids = Array.from({ length: 20_000 }, (_, i) => `K${i}`);
  const cube = { __cube: true, depth: 1, columns: [{ name: "id", cells: ids }, { name: "v", cells: ids.map((_, i) => i) }] };
  const n = new XLookupNode();
  n.stringLiterals = { lookup: "", inColumn: "id", returnColumn: "v", ifNotFound: "" };
  const { v, ms } = timed(() => (n.data({ frame: [cube], lookup: [[...ids].reverse()] }) as { value: unknown }).value);
  expect(ms).toBeLessThan(3000);
  expect((v as number[])[0]).toBe(19_999);
});

it("PERCENTILE, PERCENTRANK and LARGE per row of a computed column sort the column once", async () => {
  const { computeColumnOnEngine } = await import("../../src/graph/frameBackend");
  const n = 20_000;
  const score = Array.from({ length: n }, (_, i) => (i * 7919) % n);
  const frame = { __frame: true as const, columns: [
    { name: "score", type: "number" as const, values: score },
    { name: "p", type: "number" as const, values: score.map((s) => s / n) },
  ] };
  for (const src of ["PERCENTRANK(score, @score)", "PERCENTILE(score, @p)", "LARGE(score, 1 + MOD(@score, 10))"]) {
    const { v, ms } = timed(() => computeColumnOnEngine(frame, src, n));
    expect(ms, src).toBeLessThan(3000);
    expect((v as { cells: unknown[] }).cells.length, src).toBe(n);
  }
  const small = computeColumnOnEngine({ __frame: true, columns: [{ name: "s", type: "number", values: [10, 20, 30, 40] }] }, "PERCENTRANK(s, @s)", 4);
  expect((small as { cells: unknown[] }).cells).toEqual([0, 0.333, 0.666, 1]);
});
