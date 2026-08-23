import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../excelFormula";
import { FUNCTION_FAMILY, FAMILY_BACKING, internalFunctionNames } from "../excelFunctions";
import { AggregateNode } from "./list";
import { RankPercentileNode, CorrelNode, CovarianceNode, RegressionNode, ModeNode, FisherNode } from "./stats";
import { isSolError } from "../errorValue";

// capabilityParity / shareImpl for the STATISTICS family (the A1 backing flip): every
// formula below runs the statsOps kernel its node runs, so the two surfaces must agree
// on value, blank and error alike. A new divergence fails here, not in a user's sheet.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const same = (a: unknown, b: unknown) => {
  if (isSolError(a) || isSolError(b)) expect(isSolError(a) && isSolError(b) && a.code === b.code, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true);
  else if (typeof a === "number" && typeof b === "number") expect(a).toBeCloseTo(b, 12);
  else expect(a).toEqual(b);
};

const SAMPLES: (number | null)[][] = [
  [3, 1, 4, 1, 5, 9, 2, 6],
  [5],
  [2, null, 4, 4, 7],
  [1, 1, 1],
  [-4, 9],
  [0.5, 2.5, 7, 7, 7, 11],
];

describe("statistics formulas == Aggregate node (one statsOps kernel)", () => {
  const OPS: Array<[string, string]> = [
    ["AVERAGE", "avg"], ["AVEDEV", "avedev"], ["MEDIAN", "median"], ["GEOMEAN", "geomean"],
    ["HARMEAN", "harmean"], ["DEVSQ", "devsq"], ["STDEV", "stdev"], ["STDEV.S", "stdev"],
    ["STDEV.P", "stdev_p"], ["VAR", "var_s"], ["VAR.S", "var_s"], ["VAR.P", "var_p"],
    ["SKEW", "skew"], ["SKEW.P", "skew_p"], ["KURT", "kurt"],
  ];
  it.each(OPS)("%s(list) == Aggregate %s", (fn, op) => {
    for (const list of SAMPLES) {
      const node = new AggregateNode({ op: op as never }).data({ list: [list] }).result;
      same(ev(`${fn}(x)`, { x: list }), node);
    }
  });
  it("a formula over several args flattens them into one sample", () => {
    expect(ev("AVERAGE(a, 10, b)", { a: [1, 2], b: [3] })).toBeCloseTo(4, 12);
  });
});

describe("order statistics formulas == Rank & Percentile node", () => {
  const list = [3, 1, 4, 1, 5, 9, 2, 6];
  const node = (op: string, key: string, v: number) => {
    const n = new RankPercentileNode({ op: op as never });
    return n.data({ list: [list], [key]: [v] } as never).result;
  };
  it("LARGE / SMALL", () => {
    for (const k of [1, 3, 8, 9, 0]) {
      same(ev("LARGE(x, k)", { x: list, k }), node("large", "k", k));
      same(ev("SMALL(x, k)", { x: list, k }), node("small", "k", k));
    }
  });
  it("PERCENTILE.INC / .EXC incl. the EXC domain", () => {
    for (const p of [0, 0.1, 0.25, 0.5, 0.9, 1, 1.2]) {
      same(ev("PERCENTILE.INC(x, p)", { x: list, p }), node("percentile-inc", "p", p));
      same(ev("PERCENTILE.EXC(x, p)", { x: list, p }), node("percentile-exc", "p", p));
    }
  });
  it("QUARTILE.INC / .EXC", () => {
    for (const q of [0, 1, 2, 3, 4]) {
      same(ev("QUARTILE.INC(x, q)", { x: list, q }), node("quartile-inc", "q", q));
      same(ev("QUARTILE.EXC(x, q)", { x: list, q }), node("quartile-exc", "q", q));
    }
  });
});

describe("paired statistics formulas == Correl / Covariance / Regression nodes", () => {
  const PAIRS: Array<[(number | null)[], (number | null)[]]> = [
    [[1, 2, 3, 4], [2, 4.1, 5.9, 8.2]],
    [[1, 1, 1], [1, 2, 3]],
    [[1, null, 3, 4], [2, 4, null, 8]],
    [[1, 2], [3, 3]],
  ];
  it.each(PAIRS)("CORREL/RSQ/COVARIANCE.P/.S/SLOPE/INTERCEPT/STEYX over %j, %j", (x, y) => {
    same(ev("CORREL(x, y)", { x, y }), new CorrelNode({ op: "correl" }).data({ x: [x], y: [y] }).result);
    same(ev("RSQ(y, x)", { x, y }), new CorrelNode({ op: "rsq" }).data({ x: [x], y: [y] }).result);
    same(ev("COVARIANCE.P(x, y)", { x, y }), new CovarianceNode({ op: "pop" }).data({ x: [x], y: [y] }).result);
    same(ev("COVARIANCE.S(x, y)", { x, y }), new CovarianceNode({ op: "samp" }).data({ x: [x], y: [y] }).result);
    for (const op of ["slope", "intercept", "steyx"] as const) {
      same(ev(`${op.toUpperCase()}(y, x)`, { x, y }), new RegressionNode({ op }).data({ xs: [x], ys: [y] }).result);
    }
  });
});

describe("MODE / FISHER", () => {
  it("MODE.SNGL is Excel's first-occurring tie; the node keeps every tie", () => {
    expect(ev("MODE.SNGL(x)", { x: [4, 2, 2, 4, 1] })).toBe(4);
    expect(ev("MODE(x)", { x: [4, 2, 2, 4, 1] })).toBe(4);
    expect(ev("MODE(x)", { x: [1, 2, 2, 3] })).toBe(2);
    expect(new ModeNode().data({ list: [[4, 2, 2, 4, 1]] }).result).toEqual([2, 4]);
    expect(new ModeNode().data({ list: [[1, 2, 2, 3]] }).result).toBe(2);
  });
  it("FISHER / FISHERINV share the domain rule", () => {
    same(ev("FISHER(0.5)"), new FisherNode({ op: "fisher" }).data({ value: [0.5] }).result);
    same(ev("FISHER(1)"), new FisherNode({ op: "fisher" }).data({ value: [1] }).result);
    same(ev("FISHERINV(0.3)"), new FisherNode({ op: "fisherinv" }).data({ value: [0.3] }).result);
  });
});

describe("CHOOSE formula == Choose node", () => {
  it("picks by 1-based index; a blank index is blank, an out-of-range one is #VALUE!, a chosen blank passes through", () => {
    expect(ev("CHOOSE(2, 10, 20, 30)")).toBe(20);
    expect(ev("CHOOSE(2, \"a\", \"b\")")).toBe("b");
    expect(ev("CHOOSE(i, 10, 20)", { i: null })).toBeNull();
    expect(ev("CHOOSE(1, 10, x)", { x: null })).toBe(10); // an UNCHOSEN blank doesn't poison the pick
    expect(ev("CHOOSE(2, 10, x)", { x: null })).toBeNull();
    const r = ev("CHOOSE(4, 10, 20)");
    expect(isSolError(r) && r.code).toBe("#VALUE!");
    // a list index spills one pick per element (the evaluator's broadcast)
    expect(ev("CHOOSE(i, 10, 20, 30)", { i: [1, 3, 2] })).toEqual([10, 30, 20]);
  });
});

// The backing table is a DECISION; this pins the live STATE against it. A family whose
// backing reads `internal` must register every overlap name internally — or name the
// stragglers here, and that list must stay honest (an entry that got registered is
// deleted, so the gap ratchets shut rather than being quietly carried).
describe("FAMILY_BACKING 'internal' ⇒ registered internally (the flip ratchet)", () => {
  const STILL_ON_FORMULAJS = new Set<string>([
    // finance-iterative: RATE has no shared kernel — the TVM node solves it as an Equation
    // (acausal), so there is no node-side function to register; FX's Newton stands.
    "RATE",
  ]);
  const internal = new Set(internalFunctionNames());
  it("every internal-backed overlap name is registered, or is a listed straggler", () => {
    const missing = Object.entries(FUNCTION_FAMILY)
      .filter(([n, f]) => FAMILY_BACKING[f].backing === "internal" && !internal.has(n) && !STILL_ON_FORMULAJS.has(n))
      .map(([n]) => n);
    expect(missing).toEqual([]);
  });
  it("the straggler list stays honest — a flipped name is removed from it", () => {
    const stale = [...STILL_ON_FORMULAJS].filter((n) => internal.has(n) || !(n in FUNCTION_FAMILY));
    expect(stale).toEqual([]);
  });
});
