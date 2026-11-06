// [[C17]] shareImpl, [[D109]] aggregatesRefuseText, [[D110]] logicRefusesText, [[formula-language#Text is text]]
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { AggregateNode, GroupListsNode, type ReduceOp } from "../../src/graph/nodes/list";
import { RankPercentileNode, type RankPercentileOp } from "../../src/graph/nodes/stats";
import { BooleanOpNode, type BooleanOp } from "../../src/graph/nodes/logic";
import { isSolError } from "../../src/graph/errorValue";
import { throughBoundary } from "./boundaryKit";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const err = (v: unknown) => (isSolError(v) ? `${v.code} ${v.message}` : JSON.stringify(v));

describe("the Aggregate card answers text as its formula", () => {
  const OPS: [ReduceOp, string][] = [
    ["sum", "SUM"], ["avg", "AVERAGE"], ["min", "MIN"], ["max", "MAX"], ["median", "MEDIAN"], ["product", "PRODUCT"],
    ["stdev", "STDEV.S"], ["stdev_p", "STDEV.P"], ["var_s", "VAR.S"], ["var_p", "VAR.P"], ["geomean", "GEOMEAN"],
    ["harmean", "HARMEAN"], ["sumsq", "SUMSQ"], ["devsq", "DEVSQ"], ["avedev", "AVEDEV"], ["skew", "SKEW"],
    ["skew_p", "SKEW.P"], ["kurt", "KURT"], ["ptp", "PTP"], ["iqr", "IQR"], ["mad", "MAD"], ["sem", "SEM"], ["cv", "CV"],
    ["rms", "RMS"], ["count", "COUNT"],
  ];
  const LISTS: unknown[][] = [[2, "a", 5, 7], [2, "2", 5], ["TRUE", 1, 2, 3], [2, "", 5, 7], [1, 2, "a", { __solError: true, code: "#N/A", message: "x" }]];
  it.each(OPS)("%s == %s", (op, fn) => {
    // COUNT leaves an error out where the card answers it: an error ruling, not a text one.
    for (const x of op === "count" ? LISTS.slice(0, 3) : LISTS) {
      const card = throughBoundary(new AggregateNode({ op })).data({ list: [x] }).result;
      expect(err(card), JSON.stringify(x)).toBe(err(ev(`${fn}(x)`, { x })));
    }
  });
  it("text is #VALUE! for arithmetic and #TYPE! for ordering, not the port's #TYPE!", () => {
    const run = (op: ReduceOp) => throughBoundary(new AggregateNode({ op })).data({ list: [[2, "a"]] }).result;
    expect(err(run("sum"))).toBe("#VALUE! SUM needs numbers, not text; Cast it to a number first");
    expect(err(run("max"))).toBe("#TYPE! MAX can't order text among numbers; Cast it to a number first");
    expect(run("count")).toBe(1);
  });
  it("empty text is nothing typed: the total skips it", () => {
    expect(throughBoundary(new AggregateNode({ op: "sum" })).data({ list: [[2, "", 5]] }).result).toBe(7);
  });
});

describe("Rank & Percentile answers text in its list as LARGE, SMALL, PERCENTILE and QUARTILE do", () => {
  const OPS: [RankPercentileOp, string, string][] = [
    ["large", "LARGE", "k"], ["small", "SMALL", "k"], ["percentile-inc", "PERCENTILE.INC", "p"],
    ["percentile-exc", "PERCENTILE.EXC", "p"], ["quartile-inc", "QUARTILE.INC", "q"], ["quartile-exc", "QUARTILE.EXC", "q"],
  ];
  it.each(OPS)("%s == %s", (op, fn, key) => {
    const at = key === "k" ? 1 : key === "p" ? 0.5 : 1;
    for (const x of [[2, "a", 5, 7], [2, "5", 7], [2, "", 5, 7]]) {
      const card = throughBoundary(new RankPercentileNode({ op })).data({ list: [x], [key]: [at] }).result;
      expect(err(card), JSON.stringify(x)).toBe(err(ev(`${fn}(x, ${at})`, { x })));
    }
  });
});

describe("the Boolean Op card answers text as AND, OR, XOR, NAND, NOR and XNOR do", () => {
  const OPS: BooleanOp[] = ["and", "or", "xor", "nand", "nor", "xnor"];
  it.each(OPS)("%s", (op) => {
    for (const [a, b] of [[true, "a"], [false, "a"], [true, "TRUE"], ["2", false]] as const) {
      const card = throughBoundary(new BooleanOpNode({ op })).data({ a0: [a], a1: [b] }).result;
      expect(err(card), `${a}, ${b}`).toBe(err(ev(`${op.toUpperCase()}(a, b)`, { a, b })));
    }
  });
  it("item by item, a text item is the formula's answer for that item", () => {
    const card = throughBoundary(new BooleanOpNode({ op: "and" })).data({ a0: [true], a1: [[true, "a"]] }).result as unknown[];
    expect(card[0]).toBe(true);
    expect(err(card[1])).toBe(err(ev('AND(TRUE, "a")')));
  });
});

it("Group Lists answers a group holding text as GROUPBY with its formula", () => {
  const k = ["a", "b", "a"], v = [1, 2, "x"];
  for (const [agg, fn] of [["sum", "SUM"], ["avg", "AVERAGE"], ["min", "MIN"], ["max", "MAX"]] as const) {
    const cols = throughBoundary(new GroupListsNode({ agg })).data({ keys: [k], values: [v] }).result!.columns;
    const fx = ev(`GROUPBY(k, v, LAMBDA(g, ${fn}(g)))`, { k, v }) as unknown[][];
    expect(cols[1].values.map(err), agg).toEqual(fx.map((r) => err(r[1])));
  }
});
