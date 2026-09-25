// [[C25]]
import { describe, it, expect } from "vitest";
import { ArithmeticNode, arithmeticCell } from "../../src/graph/nodes/scalar";
import { fromUnit, isUnitCell, isRatio, magnitudeOf, unitLabelOf, formatUnitCell, type UnitCell } from "../../src/graph/unitValue";
import { fcUnitToUnit, applyFcUnit } from "../../src/graph/unitBridge";
import { isSolError } from "../../src/graph/errorValue";
import { UNITS } from "../../src/graph/dimension";

// Units enter a value through the Format Controller (the FC is value-mutating) or
// Convert — NOT the Number node, which is a plain literal source. These tests drive
// the algebra directly via `fromUnit` (the same base-SI cell an FC authors).
const cell = (v: number, unitId: string): UnitCell => {
  const u = fcUnitToUnit(unitId)!;
  const c = fromUnit(v, u);
  if (!isUnitCell(c)) throw new Error("expected a UnitCell");
  return c;
};

describe("arithmeticCell — dimensional algebra per op", () => {
  it("5 m ÷ 1 s = 5 m/s", () => {
    const r = arithmeticCell("div", cell(5, "m"), cell(1, "s"));
    expect(magnitudeOf(r)).toBe(5);
    expect(unitLabelOf(r)).toBe("m/s");
    expect(formatUnitCell(r as UnitCell, (n) => String(n))).toBe("5 m/s");
  });
  it("cancellation mints a PURE RATIO (5 m ÷ 1 m = 5:1, known-dimensionless)", () => {
    const r = arithmeticCell("div", cell(5, "m"), cell(1, "m"));
    expect(isRatio(r)).toBe(true);
    expect(magnitudeOf(r)).toBe(5);
    expect(formatUnitCell(r as UnitCell, String)).toBe("5:1");
    // …and an FC can't re-label a ratio with a physical unit.
    expect(isSolError(applyFcUnit(r, "usd"))).toBe(true);
    // bare ÷ bare stays a plain bare number (no tag at all)
    expect(arithmeticCell("div", 10 as never, 2 as never)).toBe(5);
  });
  it("power scales the dimension; a dimensioned exponent is #UNIT!", () => {
    const area = arithmeticCell("pow", cell(3, "m"), 2);
    expect(magnitudeOf(area)).toBe(9);
    expect(unitLabelOf(area)).toBe("m^2");
    expect(isSolError(arithmeticCell("pow", cell(3, "m"), cell(2, "s")))).toBe(true);
  });
  it("÷ by zero is #DIV/0! regardless of units", () => {
    const r = arithmeticCell("div", cell(5, "m"), cell(0, "s"));
    expect(isSolError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("#DIV/0!");
  });
});

describe("ArithmeticNode.data — units flow through the live node", () => {
  const m = fcUnitToUnit("m")!, s = fcUnitToUnit("s")!;
  it("a list of dimensioned cells divides element-wise, carrying the unit", () => {
    const node = new ArithmeticNode({ op: "div" });
    const dist = [fromUnit(10, m), fromUnit(20, m)];
    const r = node.data({ a: [dist] as never, b: [fromUnit(2, s)] as never }).result as UnitCell[];
    expect(r.map((c) => magnitudeOf(c))).toEqual([5, 10]);
    expect(r.every((c) => unitLabelOf(c) === "m/s")).toBe(true);
  });
});

describe("MathFn — dimensional signatures (avoid garbage + correct dims)", () => {
  it("SQRT of an area (m²) is a length (m)", async () => {
    const { MathFXNode } = await import("../../src/graph/nodes/scalar");
    const area = fromUnit(9, { dim: { length: 2 }, scale: 1 }) as UnitCell;
    const r = new MathFXNode({ op: "sqrt" }).data({ in: [area] as never }).result;
    expect(magnitudeOf(r)).toBe(3);
    expect(unitLabelOf(r)).toBe("m");
  });
  it("ABS preserves the unit", async () => {
    const { MathFXNode } = await import("../../src/graph/nodes/scalar");
    const r = new MathFXNode({ op: "abs" }).data({ in: [cell(-5, "m")] as never }).result;
    expect(magnitudeOf(r)).toBe(5);
    expect(unitLabelOf(r)).toBe("m");
  });
  it("LOG of a dimensioned value is #UNIT!", async () => {
    const { MathFXNode } = await import("../../src/graph/nodes/scalar");
    const r = new MathFXNode({ op: "log" }).data({ in: [cell(5, "m")] as never }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("#UNIT!");
  });
  it("SIGN of a dimensioned value is a plain number", async () => {
    const { MathFXNode } = await import("../../src/graph/nodes/scalar");
    expect(new MathFXNode({ op: "sign" }).data({ in: [cell(-5, "m")] as never }).result).toBe(-1);
  });
});

describe("Expression — dimensional interpretation over the formula (step 3)", () => {
  it("d / t carries m/s", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const n = new ExpressionNode({ expr: "d / t" });
    const r = n.data({ d: [cell(10, "m")], t: [cell(2, "s")] }).result;
    expect(magnitudeOf(r)).toBe(5);
    expect(unitLabelOf(r)).toBe("m/s");
  });
  it("m * a → N (kg·m/s²)", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const n = new ExpressionNode({ expr: "m * a" });
    const accel = fromUnit(3, { dim: { length: 1, time: -2 }, scale: 1 }) as UnitCell;
    const r = n.data({ m: [cell(2, "kg")], a: [accel] }).result;
    expect(magnitudeOf(r)).toBe(6);
    expect(unitLabelOf(r)).toBe("N");
  });
  it("d + t (incommensurable) is #UNIT!", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const n = new ExpressionNode({ expr: "d + t" });
    const r = n.data({ d: [cell(1, "m")], t: [cell(1, "s")] }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("#UNIT!");
  });
  it("SIN of a length is #UNIT!", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const n = new ExpressionNode({ expr: "SIN(d)" });
    expect(isSolError(n.data({ d: [cell(1, "m")] }).result)).toBe(true);
  });
  it("plain-number formula is unchanged", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const n = new ExpressionNode({ expr: "a + b" });
    expect(n.data({ a: [2], b: [3] }).result).toBe(5);
  });
  // [[C25]] firstClassUnits, [[B16]] oneFormulaSurface: the formula reads a united input
  // as the Arithmetic and Comparison cards do, in its display unit.
  it("a bare number adopts the display unit: 5 km + 3 is 8 km, and 5 km > 3000 is FALSE", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const km = applyFcUnit(5, "km");
    const run = (expr: string, a: unknown) => new ExpressionNode({ expr }).data({ a: [a as never] }).result;
    const sum = run("a + 3", km) as UnitCell;
    expect(sum.display).toBe("km");
    expect(displayMagnitudeOf(sum)).toBeCloseTo(8, 9);
    expect(run("a > 3000", km)).toBe(false);
    expect(run("a & \"x\"", km)).toBe("5x");
    expect(displayMagnitudeOf(run("ROUND(a, 1)", applyFcUnit(1.44, "km")) as UnitCell)).toBeCloseTo(1.4, 9);
    expect(displayMagnitudeOf(run("INT(a)", applyFcUnit(1.7, "km")) as UnitCell)).toBeCloseTo(1, 9);
    const area = run("a * a", km) as UnitCell;
    expect(magnitudeOf(area)).toBeCloseTo(25e6, 3); // 25 km² in base m²
  });
  it("°C follows the Arithmetic card: a reading ± a delta is a reading, two readings subtract to a delta", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const t20 = applyFcUnit(20, "degC"), t30 = applyFcUnit(30, "degC");
    const run = (expr: string) => new ExpressionNode({ expr }).data({ a: [t20 as never], b: [t30 as never] }).result;
    const warm = run("a + 5") as UnitCell;
    expect(warm.display).toBe("degC");
    expect(displayMagnitudeOf(warm)).toBeCloseTo(25, 9);
    const mean = run("(a + b) / 2") as UnitCell;
    expect(displayMagnitudeOf(mean)).toBeCloseTo(25, 9);
    const diff = run("b - a") as UnitCell;
    expect(diff.display).toBeUndefined();
    expect(magnitudeOf(diff)).toBeCloseTo(10, 9); // 10 K
    expect(run("a > 25")).toBe(false);
    expect((run("a * 2") as { code?: string }).code).toBe("#UNIT!");
    expect((run("b / a") as { code?: string }).code).toBe("#UNIT!");
    expect(run("(b - a) / (b - a)")).toBe(1);
  });
  it("°C is classified statically: volatile functions, MIN/AVERAGE, SUM and lists", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const t20 = applyFcUnit(20, "degC"), t30 = applyFcUnit(30, "degC");
    const run = (expr: string, a: unknown = t20, b: unknown = t30) =>
      new ExpressionNode({ expr }).data({ a: [a as never], b: [b as never] }).result;
    const code = (v: unknown) => (v as { code?: string }).code;
    for (let i = 0; i < 5; i++) expect((run("IF(RAND() < 2, a, b)") as UnitCell).display).toBe("degC");
    expect(displayMagnitudeOf(run("MIN(a, 25)") as UnitCell)).toBeCloseTo(20, 9);
    expect(displayMagnitudeOf(run("AVERAGE(a, b)") as UnitCell)).toBeCloseTo(25, 9);
    expect(code(run("SUM(a, b)"))).toBe("#UNIT!");
    expect(code(run("SQRT(a)"))).toBe("#UNIT!");
    expect(displayMagnitudeOf(run("ROUND(a + 0.4, 0)") as UnitCell)).toBeCloseTo(20, 9);
    const list = [t20, t30];
    expect(displayMagnitudeOf(run("AVERAGE(a)", list) as UnitCell)).toBeCloseTo(25, 9);
    expect(code(run("SUM(a)", list))).toBe("#UNIT!");
    expect(magnitudeOf(run("MAX(a) - MIN(a)", list) as UnitCell)).toBeCloseTo(10, 9); // 10 K
  });
  it("a bare branch adopts the other branch's unit: IF(c, a, 0) keeps km and °C", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const run = (expr: string, a: unknown, c: boolean) => new ExpressionNode({ expr }).data({ a: [a as never], c: [c as never] }).result;
    const km = applyFcUnit(5, "km"), t20 = applyFcUnit(20, "degC");
    for (const [expr, c, want] of [["IF(c, a, 0)", true, 5], ["IF(c, a, 0)", false, 0], ["IFERROR(a, 0)", true, 5], ["CHOOSE(2, 1, a)", true, 5]] as const) {
      const r = run(expr, km, c) as UnitCell;
      expect(r.display, expr).toBe("km");
      expect(displayMagnitudeOf(r)).toBeCloseTo(want, 9);
    }
    const cold = run("IF(c, a, 0)", t20, false) as UnitCell;
    expect(cold.display).toBe("degC");
    expect(displayMagnitudeOf(cold)).toBeCloseTo(0, 9);
    expect((run("IF(c, a, a - a)", t20, true) as { code?: string }).code).toBe("#UNIT!");
    const mixed = new ExpressionNode({ expr: "IF(c, a, b)" }).data({ a: [km as never], b: [applyFcUnit(2, "s") as never], c: [true as never] }).result;
    expect(isUnitCell(mixed)).toBe(false);
  });
  it("a LAMBDA host reads its lambda's body: REDUCE, MAP and BYROW over a united list", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const run = (expr: string, a: unknown) => new ExpressionNode({ expr }).data({ a: [a as never] }).result;
    const code = (v: unknown) => (v as { code?: string }).code;
    const kms = [applyFcUnit(1, "km"), applyFcUnit(3, "km")];
    const total = run("REDUCE(0, a, LAMBDA(acc, v, acc + v))", kms) as UnitCell;
    expect(total.display).toBe("km");
    expect(displayMagnitudeOf(total)).toBeCloseTo(4, 9);
    expect(displayMagnitudeOf(run("MAX(MAP(a, LAMBDA(v, v * 2)))", kms) as UnitCell)).toBeCloseTo(6, 9);
    expect(isUnitCell(run("REDUCE(1, a, LAMBDA(acc, v, acc * v))", kms))).toBe(false);
    const temps = [applyFcUnit(20, "degC"), applyFcUnit(30, "degC")];
    const top = run("REDUCE(0, a, MAX)", temps) as UnitCell;
    expect(top.display).toBe("degC");
    expect(displayMagnitudeOf(top)).toBeCloseTo(30, 9);
    expect(code(run("REDUCE(0, a, LAMBDA(acc, v, acc + v))", temps))).toBe("#UNIT!");
    expect(code(run("MAX(MAP(a, LAMBDA(v, v * 2)))", temps))).toBe("#UNIT!");
    expect(displayMagnitudeOf(run("LAMBDA(x, x + 1)(a)", applyFcUnit(1, "km")) as UnitCell)).toBeCloseTo(2, 9);
  });
  it("a function outside the unit tables is loud on a unit, and plain beside one", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const run = (expr: string, a: unknown) => new ExpressionNode({ expr }).data({ a: [a as never] }).result;
    const t20 = applyFcUnit(20, "degC"), km = applyFcUnit(5, "km");
    const kept = run("a + RAND() * 0", t20) as UnitCell;
    expect(kept.display).toBe("degC");
    expect(displayMagnitudeOf(kept)).toBeCloseTo(20, 9);
    expect((run("a + FACT(3)", km) as UnitCell).display).toBe("km");
    expect(displayMagnitudeOf(run("a + FACT(3)", km) as UnitCell)).toBeCloseTo(11, 9);
    expect((run("FACT(a)", km) as { code?: string }).code).toBe("#UNIT!");
    expect(run("FACT(3) + 1", km)).toBe(7);
  });
  it("°C through the declared tables: spreads, picks and criteria", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const { displayMagnitudeOf } = await import("../../src/graph/unitBridge");
    const run = (expr: string, a: unknown) => new ExpressionNode({ expr }).data({ a: [a as never] }).result;
    const code = (v: unknown) => (v as { code?: string }).code;
    const list = [applyFcUnit(20, "degC"), applyFcUnit(30, "degC")];
    const sd = run("STDEV(a)", list) as UnitCell;
    expect(sd.display).toBeUndefined();
    expect(magnitudeOf(sd)).toBeCloseTo(Math.SQRT2 * 5, 9); // 7.07 K
    const top = run("LARGE(a, 1)", list) as UnitCell;
    expect(top.display).toBe("degC");
    expect(displayMagnitudeOf(top)).toBeCloseTo(30, 9);
    expect(displayMagnitudeOf(run('AVERAGEIF(a, ">0")', list) as UnitCell)).toBeCloseTo(25, 9);
    expect(code(run('SUMIF(a, ">0")', list))).toBe("#UNIT!");
    const fl = [applyFcUnit(50, "degF"), applyFcUnit(68, "degF")];
    expect(magnitudeOf(run("VAR(a)", fl) as UnitCell)).toBeCloseTo(50, 9); // 162 °F² is 50 K²
    const kmList = [applyFcUnit(1, "km"), applyFcUnit(3, "km")];
    expect(displayMagnitudeOf(run("MEDIAN(SORT(a))", kmList) as UnitCell)).toBeCloseTo(2, 9);
  });
  it("readings in different offset units still classify: °C + °F is #UNIT!", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const run = (expr: string) => new ExpressionNode({ expr })
      .data({ a: [applyFcUnit(20, "degC") as never], b: [applyFcUnit(68, "degF") as never] }).result;
    expect((run("a + b") as { code?: string }).code).toBe("#UNIT!");
    expect(magnitudeOf(run("b - a") as UnitCell)).toBeCloseTo(0, 9); // 68 °F is 20 °C
    expect(magnitudeOf(run("(a + b) / 2") as UnitCell)).toBeCloseTo(293.15, 9);
  });
  it("inputs in different units still compute in base SI", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const r = new ExpressionNode({ expr: "a + b" }).data({ a: [applyFcUnit(1, "km") as never], b: [applyFcUnit(500, "m") as never] }).result;
    expect(magnitudeOf(r as UnitCell)).toBeCloseTo(1500, 9);
  });
});

describe("unit bridge", () => {
  it("resolves compound + prefixed FC ids", () => {
    expect(fcUnitToUnit("mph")).toEqual(UNITS.mi && { dim: { length: 1, time: -1 }, scale: 1609.344 / 3600 });
    expect(fcUnitToUnit("km")?.scale).toBe(1000);
    expect(fcUnitToUnit("none")).toBeNull();
  });
});

describe("custom units — an opaque free-text unit is its own dimension", () => {
  it("applyFcUnit(custom, 'poop') tags an opaque poop dimension (no display id)", () => {
    const out = applyFcUnit(5, "custom", "poop") as UnitCell;
    expect(out.value).toBe(5);
    expect(unitLabelOf(out)).toBe("poop");
    expect(out.display).toBeUndefined(); // no registry id — formatDim renders the name
  });

  it("poop ÷ s = poop/s (NOT Hz — the custom axis survives the division)", () => {
    const poop = applyFcUnit(5, "custom", "poop");
    const sec = applyFcUnit(1, "s");
    const r = arithmeticCell("div", poop as never, sec as never);
    expect(unitLabelOf(r)).toBe("poop/s");
  });

  it("poop + poop = poop; poop + s = #UNIT!; two DIFFERENT customs separate", () => {
    const a = applyFcUnit(2, "custom", "poop");
    const b = applyFcUnit(3, "custom", "poop");
    expect(unitLabelOf(arithmeticCell("add", a as never, b as never))).toBe("poop");
    const sec = applyFcUnit(1, "s");
    expect(isSolError(arithmeticCell("add", a as never, sec as never))).toBe(true);
    const foo = applyFcUnit(1, "custom", "foo");
    expect(isSolError(arithmeticCell("add", a as never, foo as never))).toBe(true);
    expect(unitLabelOf(arithmeticCell("mul", a as never, foo as never))).toBe("foo·poop");
  });

  it("custom axes are case-INSENSITIVE: Poop + poop adds (same quantity, one axis)", () => {
    // Two FCs differing only in typed case must not #UNIT! against each other; the
    // typed casing still shows through the display id.
    const a = applyFcUnit(2, "custom", "Poop");
    const b = applyFcUnit(3, "custom", "poop");
    const sum = arithmeticCell("add", a as never, b as never);
    expect(isSolError(sum)).toBe(false);
    expect(magnitudeOf(sum)).toBe(5);
  });

  it("a bare number adopts in the DISPLAY unit: 5 km + 3 = 8 km (author 2026-07-16)", () => {
    const km5 = applyFcUnit(5, "km");
    const sum = arithmeticCell("add", km5 as never, 3 as never);
    expect(magnitudeOf(sum)).toBe(8000); // base-SI meters — the 3 read as 3 km
    expect((sum as UnitCell).display).toBe("km"); // display id rides (unitLabelOf shows the derived dim symbol)
    // × keeps the face value — a bare factor is a factor, not a length.
    expect(magnitudeOf(arithmeticCell("mul", km5 as never, 2 as never))).toBe(10000);
  });

  it("a bare number still ADOPTS a custom unit (poop × 2 = poop, poop + 3 = poop)", () => {
    const p = applyFcUnit(2, "custom", "poop");
    expect(unitLabelOf(arithmeticCell("mul", p as never, 2 as never))).toBe("poop");
    expect(unitLabelOf(arithmeticCell("add", p as never, 3 as never))).toBe("poop");
  });

  it("a blank custom name is a no-op (stays a bare number)", () => {
    expect(applyFcUnit(5, "custom", "")).toBe(5);
    expect(applyFcUnit(5, "custom", "   ")).toBe(5);
    expect(applyFcUnit(5, "custom", undefined)).toBe(5);
  });
});
