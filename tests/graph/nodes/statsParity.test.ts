import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { RankPercentileNode, CorrelNode, FisherNode, ModeNode } from "../../../src/graph/nodes/stats";
import { isSolError } from "../../../src/graph/errorValue";

// capabilityParity / [[C17]] shareImpl for the STATISTICS family (the A1 backing flip): every
// formula below runs the statsOps kernel its node runs, so the two surfaces must agree
// on value, blank and error alike. A new divergence fails here, not in a user's sheet.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const same = (a: unknown, b: unknown) => {
  if (isSolError(a) || isSolError(b)) expect(isSolError(a) && isSolError(b) && a.code === b.code, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true);
  else if (typeof a === "number" && typeof b === "number") expect(a).toBeCloseTo(b, 12);
  else expect(a).toEqual(b);
};


describe("statistics formulas == Aggregate node (one statsOps kernel)", () => {
  it("a formula over several args flattens them into one sample", () => {
    expect(ev("AVERAGE(a, 10, b)", { a: [1, 2], b: [3] })).toBeCloseTo(4, 12);
  });
});


describe("a first-class infinity is a value, as on the cards", () => {
  const code = (v: unknown) => (v as { code?: string }).code;
  it("an order statistic lands on it or past it; a spread around it is undefined", () => {
    expect(ev("AVERAGE(x)", { x: [1, 2, Infinity] })).toBe(Infinity);
    expect(ev("MEDIAN(x)", { x: [1, 2, Infinity] })).toBe(2);
    expect(ev("PERCENTILE.INC(x, 1)", { x: [1, 2, Infinity] })).toBe(Infinity);
    expect(ev("PERCENTILE.INC(x, 0.75)", { x: [1, 2, Infinity] })).toBe(Infinity);
    expect(ev("PERCENTILE.INC(x, 0.25)", { x: [-Infinity, 1, 2] })).toBe(-Infinity);
    expect(code(ev("PERCENTILE.INC(x, 0.5)", { x: [-Infinity, Infinity] }))).toBe("#DOMAIN!");
    expect(code(ev("STDEV(x)", { x: [1, 2, Infinity] }))).toBe("#DOMAIN!");
    expect(code(ev("CORREL(x, y)", { x: [1, 2, Infinity], y: [2, 4, 6] }))).toBe("#DOMAIN!");
  });
});

describe("the numpy / pandas / R one-liners answer what scipy answers", () => {
  const x = [2, 4, 4, 4, 5, 5, 7, 9];
  it("PTP / IQR / MAD / SEM / CV / RMS", () => {
    expect(ev("PTP(x)", { x })).toBe(7);
    expect(ev("IQR(x)", { x })).toBeCloseTo(1.5, 12);          // numpy percentile 75 − 25 (linear) = 5.5 − 4
    expect(ev("MAD(x)", { x })).toBe(0.5);                      // scipy median_abs_deviation: median 4.5 → |dev| sorted .5×5, 2.5, 2.5, 4.5 → 0.5
    expect(ev("SEM(x)", { x })).toBeCloseTo(2.138089935299395 / Math.sqrt(8), 12);
    expect(ev("CV(x)", { x })).toBeCloseTo(2.138089935299395 / 5, 12);
    expect(ev("RMS(x)", { x })).toBeCloseTo(Math.sqrt(232 / 8), 12);
    expect(ev("SEM(x)", { x: [1] })).toBeNull();
    expect(isSolError(ev("CV(x)", { x: [-1, 1] }))).toBe(true); // mean 0
  });
  it("SPEARMAN / KENDALL == Correl node, with scipy's values", () => {
    const a = [1, 2, 3, 4, 5], b = [5, 6, 7, 8, 7];
    same(ev("SPEARMAN(a, b)", { a, b }), new CorrelNode({ op: "spearman" }).data({ x: [a], y: [b] }).result);
    same(ev("KENDALL(a, b)", { a, b }), new CorrelNode({ op: "kendall" }).data({ x: [a], y: [b] }).result);
    expect(ev("SPEARMAN(a, b)", { a, b })).toBeCloseTo(0.8207826816681233, 12); // scipy.stats.spearmanr
    expect(ev("KENDALL(a, b)", { a, b })).toBeCloseTo(0.7378647873726218, 12);  // scipy.stats.kendalltau (tau-b)
    expect(ev("SPEARMAN(a, c)", { a, c: [1, 4, 9, 16, 25] })).toBe(1);          // any monotone map is ρ = 1
  });
});

describe.each([
  [[3, 1, 4, 1, 5, 9, 2, 6]],
  [[3, Infinity, 4, 1, -Infinity, 2]],
])("order statistics formulas == Rank & Percentile node over %j", (list) => {
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


describe("MODE / FISHER", () => {
  it("MODE.SNGL is Excel's first-occurring tie; the node keeps every tie", () => {
    expect(ev("MODE.SNGL(x)", { x: [4, 2, 2, 4, 1] })).toBe(4);
    expect(ev("MODE(x)", { x: [4, 2, 2, 4, 1] })).toBe(4);
  });
  it("no value repeating is Excel's #N/A, in the formulas and on the card", () => {
    const code = (v: unknown) => (isSolError(v) ? v.code : v);
    for (const f of ["MODE", "MODE.SNGL", "MODE.MULT"]) expect(code(ev(`${f}(x)`, { x: [1, 2, 3] })), f).toBe("#N/A");
    expect(code(ev("MODE(5)"))).toBe("#N/A");
    expect(code(new ModeNode().data({ list: [[1, 2, 3]] }).result)).toBe("#N/A");
  });
  // [[C24]] arraySemantics: a NaN in the data is #DOMAIN!, never skipped and never passed on bare.
  it("a NaN makes MODE, MODE.MULT, the Mode card and PRODUCT #DOMAIN!", () => {
    const code = (v: unknown) => (isSolError(v) ? v.code : v);
    for (const f of ["MODE", "MODE.SNGL", "MODE.MULT", "PRODUCT"]) expect(code(ev(`${f}(x)`, { x: [1, NaN, 3] })), f).toBe("#DOMAIN!");
    expect(code(new ModeNode().data({ list: [[1, NaN, NaN, 3]] }).result)).toBe("#DOMAIN!");
  });
  it("PRODUCT refuses text in a list, where Excel skips it ([[D109]] aggregatesRefuseText), and is 1 with no numbers ([[D125]] aggregatesOfNothing)", () => {
    const code = (v: unknown) => (isSolError(v) ? v.code : v);
    expect(code(ev("PRODUCT(x)", { x: [2, 3, null, "a"] }))).toBe("#VALUE!");
    expect(ev("PRODUCT(x)", { x: [2, 3, null] })).toBe(6);
    expect(ev("PRODUCT(x)", { x: [null] })).toBe(1);
  });
  it("FISHER / FISHERINV share the domain rule", () => {
    same(ev("FISHER(0.5)"), new FisherNode({ op: "fisher" }).data({ value: [0.5] }).result);
    same(ev("FISHER(1)"), new FisherNode({ op: "fisher" }).data({ value: [1] }).result);
    same(ev("FISHERINV(0.3)"), new FisherNode({ op: "fisherinv" }).data({ value: [0.3] }).result);
  });
});

describe("CHOOSE formula == Choose node", () => {
  it("picks by 1-based index; a blank index is #SYNTAX!, an out-of-range one is #VALUE!, a chosen blank passes through", () => {
    expect(ev("CHOOSE(2, 10, 20, 30)")).toBe(20);
    expect(ev("CHOOSE(2, \"a\", \"b\")")).toBe("b");
    const blankIdx = ev("CHOOSE(i, 10, 20)", { i: null });
    expect(isSolError(blankIdx) && blankIdx.code).toBe("#SYNTAX!");
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
