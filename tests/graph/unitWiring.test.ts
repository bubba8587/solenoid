// [[C25]]
import { describe, it, expect } from "vitest";

import { arithmeticCell } from "./coreVerbs";
import { fromUnit, isUnitCell, isRatio, magnitudeOf, dimOf, formatUnitCell, type UnitCell } from "../../src/graph/unitValue";
import { applyFcUnit } from "../../src/graph/unitBridge";
import { fcUnitToUnit } from "../../src/graph/dimension";
import { isSolError } from "../../src/graph/errorValue";
import { formatDim } from "../../src/graph/dimension";

const unitLabelOf = (v: unknown) => formatDim(dimOf(v));

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




describe("unit bridge", () => {
  it("resolves compound + prefixed FC ids", () => {
    expect(fcUnitToUnit("mph")).toEqual({ dim: { length: 1, time: -1 }, scale: 1609.344 / 3600 });
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
