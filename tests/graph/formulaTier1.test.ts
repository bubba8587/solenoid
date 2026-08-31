import { describe, it, expect } from "vitest";
import { resolveExcelFunction, LEGACY_ALIASES } from "../../src/graph/excelFunctions";
import { compileEvaluator, formulaFunctionNames, RANGE_FUNCTIONS } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";
import { TextSplitNode, TextAfterBeforeNode, UrlEncodeNode, RegexNode } from "../../src/graph/nodes/text";
import { CouponNode, BondPriceNode, DurationNode, DepreciationNode } from "../../src/graph/nodes/finance";
import { ForecastNode } from "../../src/graph/nodes/stats";

// ─── Tier 1 registrations (formulaNaming) ───────────────────────────────────────────────
// The gap these close: a node carried an Excel name, and typing that same name in
// an Expression returned #NAME?. Two things have to hold for each one, and the
// second is the one that rots silently:
//   1. the name DISPATCHES;
//   2. it computes what the NODE computes — same input, same answer.
// The registrations import the node's own helper precisely so (2) is structural,
// but a future "small tweak" to one surface is exactly how they drifted the first
// time, so it gets asserted rather than assumed.

const ev = (expr: string, env: Record<string, unknown> = {}) => {
  const f = compileEvaluator(expr);
  expect(f, `failed to compile: ${expr}`).not.toBeNull();
  return f!(env);
};

describe("blocked spellings redirect to a LIVE replacement", () => {
  // The redirect hint is the whole value of blocking: pointing a user at a name
  // that also fails would be worse than leaving the legacy one callable.
  it("every LEGACY_ALIASES target actually dispatches", () => {
    const dead = [...new Set(Object.values(LEGACY_ALIASES))].filter((t) => !resolveExcelFunction(t));
    expect(dead, `blocked names redirect to targets that do not dispatch: ${dead.join(", ")}`).toEqual([]);
  });

  it("no alias redirects to another blocked name", () => {
    const chained = Object.entries(LEGACY_ALIASES).filter(([, to]) => to in LEGACY_ALIASES);
    expect(chained.map(([f, t]) => `${f}→${t}`)).toEqual([]);
  });

  it("returns ONE #NAME? for a list argument, not a list of them", () => {
    const r = ev("VLOOKUP(2, x, 1)", { x: [1, 2, 3] });
    expect(isSolError(r) && r.code).toBe("#NAME?");
    expect(isSolError(r) && r.message).toBe("Use XLOOKUP");
  });

  it("blocks the superseded statistics spellings", () => {
    // TDIST redirects to T.DIST.RT (Microsoft's own compat mapping — TDIST was
    // right-tailed/2T, never the density-capable T.DIST).
    for (const [name, use] of [["NORMDIST", "NORM.DIST"], ["TDIST", "T.DIST.RT"], ["CRITBINOM", "BINOM.INV"]]) {
      const r = ev(`${name}(1, 2, 3, TRUE)`);
      expect(isSolError(r) && r.code, name).toBe("#NAME?");
      expect(isSolError(r) && r.message, name).toBe(`Use ${use}`);
    }
  });

  it("blocks the fn-code aggregators and the PRECISE/ISO rounding variants (retired Composable tier)", () => {
    for (const [expr, use] of [
      ["SUBTOTAL(9, 4)", "SUM"], ["AGGREGATE(9, 4, 5)", "SUM"],
      ["CEILING.PRECISE(4.2)", "CEILING.MATH"], ["FLOOR.PRECISE(-4.2)", "FLOOR.MATH"],
      ["ISO.CEILING(4.2)", "CEILING.MATH"],
    ]) {
      const r = ev(expr);
      expect(isSolError(r) && r.code, expr).toBe("#NAME?");
      expect(isSolError(r) && r.message, expr).toBe(`Use ${use}`);
    }
  });
});

describe("current-Excel names the fxLookup walk used to advertise but not dispatch", () => {
  // FX hangs these off a CALLABLE parent (FX.CEILING is the function AND the home
  // of CEILING.MATH); the old object-only walk couldn't reach them.
  it.each(["CEILING.MATH", "FLOOR.MATH",
           "GAMMALN.PRECISE", "SKEW.P", "T.TEST", "NETWORKDAYS.INTL", "WORKDAY.INTL",
           "BINOM.DIST.RANGE"])("%s dispatches", (name) => {
    expect(resolveExcelFunction(name)).not.toBeNull();
  });

  it("computes, not just resolves", () => {
    expect(ev("CEILING.MATH(4.2)")).toBe(5);
    expect(ev("FLOOR.MATH(-4.2)")).toBe(-5);
  });
});

describe("text functions: formula matches node", () => {
  it("TEXTSPLIT", () => {
    const node = new TextSplitNode();
    const fromNode = node.data({ text: ["a,b,c"], delimiter: [","] }).result;
    expect(ev('TEXTSPLIT("a,b,c", ",")')).toEqual(fromNode);
    expect(fromNode).toEqual(["a", "b", "c"]);
  });

  it("TEXTAFTER / TEXTBEFORE, including the not-found blank", () => {
    const after = new TextAfterBeforeNode({ op: "after" });
    const before = new TextAfterBeforeNode({ op: "before" });
    expect(ev('TEXTAFTER("user@example.com", "@")')).toBe(after.data({ text: ["user@example.com"], delimiter: ["@"] }).result);
    expect(ev('TEXTBEFORE("user@example.com", "@")')).toBe(before.data({ text: ["user@example.com"], delimiter: ["@"] }).result);
    expect(ev('TEXTAFTER("no delimiter here", "@")')).toBeNull();
  });

  it("ENCODEURL", () => {
    const node = new UrlEncodeNode({ op: "encode" });
    expect(ev('ENCODEURL("a b&c")')).toBe(node.data({ text: ["a b&c"] }).result);
    expect(ev('ENCODEURL("a b&c")')).toBe("a%20b%26c");
  });

  it("REGEXTEST / REGEXEXTRACT / REGEXREPLACE", () => {
    const test = new RegexNode({ op: "test" });
    expect(ev('REGEXTEST("abc123", "\\d+")')).toBe(test.data({ text: ["abc123"], pattern: ["\\d+"] }).result);
    expect(ev('REGEXTEST("abc123", "\\d+")')).toBe(1);
    expect(ev('REGEXEXTRACT("abc123def", "\\d+")')).toBe("123");
    expect(ev('REGEXEXTRACT("a1b2", "\\d", 1)')).toEqual(["1", "2"]);
    expect(ev('REGEXREPLACE("a1b2", "\\d", "#")')).toBe("a#b#");
  });

  it("REGEXEXTRACT (groups) and REGEXREPLACE occurrence match the node", () => {
    // return_mode 2 = the first match's capture groups (the node's REGEXEXTRACT (groups) op)
    const groups = new RegexNode({ op: "extract_groups" });
    const pat = "(\\d+)-(\\d+)-(\\d+)";
    expect(ev(`REGEXEXTRACT("2026-08-21", "${pat}", 2)`))
      .toEqual(groups.data({ text: ["2026-08-21"], pattern: [pat] }).result);
    expect(ev(`REGEXEXTRACT("2026-08-21", "${pat}", 2)`)).toEqual(["2026", "08", "21"]);
    // occurrence: replace ONLY the nth match (the node's Occurrence input)
    const repl = new RegexNode({ op: "replace" });
    expect(ev('REGEXREPLACE("a1b2c3", "\\d", "#", 2)'))
      .toBe(repl.data({ text: ["a1b2c3"], pattern: ["\\d"], replacement: ["#"], occurrence: [2] }).result);
    expect(ev('REGEXREPLACE("a1b2c3", "\\d", "#", 2)')).toBe("a1b#c3");
    // occurrence past the last match is a no-op, and an unknown return_mode is loud.
    expect(ev('REGEXREPLACE("a1b2c3", "\\d", "#", 9)')).toBe("a1b2c3");
    const badMode = ev('REGEXEXTRACT("a1b2", "\\d", 3)');
    expect(isSolError(badMode) && badMode.code).toBe("#VALUE!");
    // occurrence 0 / unwired still replaces every match — node and formula agree.
    expect(repl.data({ text: ["a1b2c3"], pattern: ["\\d"], replacement: ["#"] }).result)
      .toBe(ev('REGEXREPLACE("a1b2c3", "\\d", "#")'));
  });
});

describe("finance functions: formula matches node", () => {
  // 15-Mar-2026 settlement, 15-Nov-2030 maturity as date serials.
  const settle = 46096, maturity = 47787;

  it("COUPNUM / COUPDAYBS", () => {
    const num = new CouponNode({ op: "coupnum" });
    expect(ev(`COUPNUM(${settle}, ${maturity}, 2)`))
      .toBe(num.data({ settle: [settle], maturity: [maturity], frequency: [2], basis: [0] }).result);
    const bs = new CouponNode({ op: "coupdaybs" });
    expect(ev(`COUPDAYBS(${settle}, ${maturity}, 2)`))
      .toBe(bs.data({ settle: [settle], maturity: [maturity], frequency: [2], basis: [0] }).result);
  });

  it("PRICE / YIELD round-trip through each other", () => {
    const priceNode = new BondPriceNode({ op: "price" });
    const price = ev(`PRICE(${settle}, ${maturity}, 0.065, 0.07, 100, 2)`);
    expect(price).toBe(priceNode.data({
      settle: [settle], maturity: [maturity], rate: [0.065], yld: [0.07], redemption: [100], frequency: [2],
    }).result);
    // The yield that reproduces that price is the yield we priced at.
    expect(ev(`YIELD(${settle}, ${maturity}, 0.065, ${price}, 100, 2)`)).toBeCloseTo(0.07, 8);
  });

  it("DURATION / MDURATION", () => {
    const node = new DurationNode({ op: "duration" });
    expect(ev(`DURATION(${settle}, ${maturity}, 0.08, 0.09, 2)`)).toBe(node.data({
      settle: [settle], maturity: [maturity], coupon: [0.08], yld: [0.09], frequency: [2], basis: [0],
    }).result);
    // Modified duration is Macaulay discounted by one period's yield.
    const mac = ev(`DURATION(${settle}, ${maturity}, 0.08, 0.09, 2)`) as number;
    expect(ev(`MDURATION(${settle}, ${maturity}, 0.08, 0.09, 2)`)).toBeCloseTo(mac / (1 + 0.09 / 2), 10);
  });

  it("VDB", () => {
    const node = new DepreciationNode({ op: "vdb" });
    expect(ev("VDB(10000, 1000, 10, 0, 1)")).toBe(node.data({
      cost: [10000], salvage: [1000], life: [10], start: [0], end: [1], factor: [2],
    }).result);
  });

  it("returns a blank, not a number, when an argument is out of range", () => {
    expect(ev(`COUPNUM(${settle}, ${maturity}, 3)`)).toBeNull(); // frequency must be 1/2/4
    expect(ev("VDB(10000, 1000, 10, 5, 2)")).toBeNull();          // end before start
  });
});

describe("FORECAST.LINEAR", () => {
  it("matches the node and predicts an exact line", () => {
    const node = new ForecastNode();
    const fromNode = node.data({ x: [4], xs: [[1, 2, 3]], ys: [[2, 4, 6]] }).result;
    expect(ev("FORECAST.LINEAR(4, ys, xs)", { ys: [2, 4, 6], xs: [1, 2, 3] })).toBe(fromNode);
    expect(fromNode).toBeCloseTo(8, 9);
  });

  it("is #DIV/0! when the known Xs have no variance", () => {
    const r = ev("FORECAST.LINEAR(4, ys, xs)", { ys: [2, 4, 6], xs: [1, 1, 1] });
    expect(isSolError(r) && r.code).toBe("#DIV/0!");
  });

  it("the superseded FORECAST spelling redirects here", () => {
    const r = ev("FORECAST(4, ys, xs)", { ys: [2, 4, 6], xs: [1, 2, 3] });
    expect(isSolError(r) && r.message).toBe("Use FORECAST.LINEAR");
  });
});

describe("the currentExcelParity gate covers the WHOLE blocklist, on every surface (blockedFailFast)", () => {
  it("every blocked spelling answers #NAME? naming its replacement", () => {
    for (const [name, use] of Object.entries(LEGACY_ALIASES)) {
      const r = ev(`${name}(1)`);
      expect(isSolError(r) && r.code, name).toBe("#NAME?");
      expect(isSolError(r) && r.message, name).toBe(`Use ${use}`);
    }
  });

  it("no blocked spelling is advertised (autocomplete/highlighting)", () => {
    const advertised = new Set(formulaFunctionNames());
    const leaked = Object.keys(LEGACY_ALIASES).filter((n) => advertised.has(n));
    expect(leaked, `blocked names still advertised: ${leaked.join(", ")}`).toEqual([]);
  });

  it("no blocked spelling gets range routing", () => {
    const leaked = Object.keys(LEGACY_ALIASES).filter((n) => RANGE_FUNCTIONS.has(n));
    expect(leaked, `blocked names still range-routed: ${leaked.join(", ")}`).toEqual([]);
  });
});
