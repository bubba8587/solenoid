import { describe, it, expect } from "vitest";
import { ArithmeticNode, arithmeticCell } from "./nodes/scalar";
import { fromUnit, isUnitCell, isRatio, magnitudeOf, unitLabelOf, formatUnitCell, type UnitCell } from "./unitValue";
import { fcUnitToUnit, applyFcUnit } from "./unitBridge";
import { isSolError } from "./errorValue";
import { UNITS } from "./dimension";

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
    expect(isUnitCell(r)).toBe(true);
    expect(magnitudeOf(r)).toBe(5);
    expect(unitLabelOf(r)).toBe("m/s");
    expect(formatUnitCell(r as UnitCell, (n) => String(n))).toBe("5 m/s");
  });
  it("mass × accel → N (kg·m/s²)", () => {
    const kg = cell(2, "kg");
    const accel: UnitCell = fromUnit(3, { dim: { length: 1, time: -2 }, scale: 1 }) as UnitCell;
    const r = arithmeticCell("mul", kg, accel);
    expect(magnitudeOf(r)).toBe(6);
    expect(unitLabelOf(r)).toBe("N");
  });
  it("+ of commensurable units adds (km + m unified at base SI)", () => {
    const r = arithmeticCell("add", cell(1, "km"), cell(500, "m"));
    expect(magnitudeOf(r)).toBe(1500);
    expect(unitLabelOf(r)).toBe("m");
  });
  it("+ of incommensurable units is #UNIT!", () => {
    const r = arithmeticCell("add", cell(5, "m"), cell(1, "s"));
    expect(isSolError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("#UNIT!");
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
  it("scalar 5 m ÷ 1 s → 5 m/s on the wire", () => {
    const node = new ArithmeticNode({ op: "div" });
    const r = node.data({ a: [fromUnit(5, m)] as never, b: [fromUnit(1, s)] as never }).result;
    expect(isUnitCell(r)).toBe(true);
    expect(unitLabelOf(r)).toBe("m/s");
  });
  it("plain-number data takes the unchanged fast path", () => {
    const node = new ArithmeticNode({ op: "add" });
    expect(node.data({ a: [2], b: [3] }).result).toBe(5);
  });
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
    const { MathFnNode } = await import("./nodes/scalar");
    const area = fromUnit(9, { dim: { length: 2 }, scale: 1 }) as UnitCell;
    const r = new MathFnNode({ op: "sqrt" }).data({ in: [area] as never }).result;
    expect(magnitudeOf(r)).toBe(3);
    expect(unitLabelOf(r)).toBe("m");
  });
  it("ABS preserves the unit", async () => {
    const { MathFnNode } = await import("./nodes/scalar");
    const r = new MathFnNode({ op: "abs" }).data({ in: [cell(-5, "m")] as never }).result;
    expect(magnitudeOf(r)).toBe(5);
    expect(unitLabelOf(r)).toBe("m");
  });
  it("LOG of a dimensioned value is #UNIT!", async () => {
    const { MathFnNode } = await import("./nodes/scalar");
    const r = new MathFnNode({ op: "log" }).data({ in: [cell(5, "m")] as never }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("#UNIT!");
  });
  it("SIGN of a dimensioned value is a plain number", async () => {
    const { MathFnNode } = await import("./nodes/scalar");
    expect(new MathFnNode({ op: "sign" }).data({ in: [cell(-5, "m")] as never }).result).toBe(-1);
  });
});

describe("Expression — dimensional interpretation over the formula (step 3)", () => {
  it("d / t carries m/s", async () => {
    const { ExpressionNode } = await import("./nodes/expression");
    const n = new ExpressionNode({ expr: "d / t" });
    const r = n.data({ d: [cell(10, "m")], t: [cell(2, "s")] }).result;
    expect(isUnitCell(r)).toBe(true);
    expect(magnitudeOf(r)).toBe(5);
    expect(unitLabelOf(r)).toBe("m/s");
  });
  it("m * a → N (kg·m/s²)", async () => {
    const { ExpressionNode } = await import("./nodes/expression");
    const n = new ExpressionNode({ expr: "m * a" });
    const accel = fromUnit(3, { dim: { length: 1, time: -2 }, scale: 1 }) as UnitCell;
    const r = n.data({ m: [cell(2, "kg")], a: [accel] }).result;
    expect(magnitudeOf(r)).toBe(6);
    expect(unitLabelOf(r)).toBe("N");
  });
  it("d + t (incommensurable) is #UNIT!", async () => {
    const { ExpressionNode } = await import("./nodes/expression");
    const n = new ExpressionNode({ expr: "d + t" });
    const r = n.data({ d: [cell(1, "m")], t: [cell(1, "s")] }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("#UNIT!");
  });
  it("SIN of a length is #UNIT!", async () => {
    const { ExpressionNode } = await import("./nodes/expression");
    const n = new ExpressionNode({ expr: "SIN(d)" });
    expect(isSolError(n.data({ d: [cell(1, "m")] }).result)).toBe(true);
  });
  it("plain-number formula is unchanged", async () => {
    const { ExpressionNode } = await import("./nodes/expression");
    const n = new ExpressionNode({ expr: "a + b" });
    expect(n.data({ a: [2], b: [3] }).result).toBe(5);
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
    expect(isUnitCell(out)).toBe(true);
    expect(out.value).toBe(5);
    expect(unitLabelOf(out)).toBe("poop");
    expect(out.display).toBeUndefined(); // no registry id — formatDim renders the name
  });

  it("poop ÷ s = poop/s (NOT Hz — the custom axis survives the division)", () => {
    const poop = applyFcUnit(5, "custom", "poop");
    const sec = applyFcUnit(1, "s");
    const r = arithmeticCell("div", poop as never, sec as never);
    expect(isUnitCell(r)).toBe(true);
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
