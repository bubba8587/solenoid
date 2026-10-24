// [[C24]]
import { describe, it, expect } from "vitest";
import { CONVERT_UNIT_DEFS, ConvertNode } from "../../../src/graph/nodes/convert";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { isSolError } from "../../../src/graph/errorValue";
import { isUnitCell, magnitudeOf, dimOf, type UnitCell } from "../../../src/graph/unitValue";
import { UNIT_ANNOTATIONS } from "../../../src/graph/formatAnnotationStore";
import { fcUnitToUnit } from "../../../src/graph/unitBridge";
import { dimEqual, type Unit } from "../../../src/graph/dimension";

/** `x` in `fromKey` read in `toKey` through the card, or null where it refuses. */
function convertValue(x: number, fromKey: string, toKey: string): number | null {
  const out = new ConvertNode({ fromUnit: fromKey, toUnit: toKey }).data({ in: [x] }).out;
  if (isSolError(out) || out == null) return null;
  const to = CONVERT_UNIT_DEFS[toKey].dim;
  return (magnitudeOf(out) - (to.offset ?? 0)) / to.scale;
}

describe("convertValue — linear units", () => {
  it("length", () => {
    expect(convertValue(1, "km", "m")).toBeCloseTo(1000, 9);
    expect(convertValue(1, "mi", "km")).toBeCloseTo(1.609344, 6);
    expect(convertValue(1, "in", "cm")).toBeCloseTo(2.54, 9);
    expect(convertValue(12, "in", "ft")).toBeCloseTo(1, 9);
  });
  it("mass", () => {
    expect(convertValue(1, "kg", "g")).toBeCloseTo(1000, 9);
    expect(convertValue(1, "lb", "kg")).toBeCloseTo(0.45359237, 8);
  });
  it("time", () => {
    expect(convertValue(1, "hr", "min")).toBeCloseTo(60, 9);
    expect(convertValue(1, "day", "hr")).toBeCloseTo(24, 9);
  });
  it("volume / pressure / energy", () => {
    expect(convertValue(1, "gal", "L")).toBeCloseTo(3.785411784, 9);
    expect(convertValue(1, "atm", "Pa")).toBeCloseTo(101325, 6);
    expect(convertValue(1, "kcal", "cal")).toBeCloseTo(1000, 9);
  });
});

describe("convertValue — temperature (affine, not just a factor)", () => {
  it("C ↔ F", () => {
    expect(convertValue(100, "degC", "degF")).toBeCloseTo(212, 9);
    expect(convertValue(32, "degF", "degC")).toBeCloseTo(0, 9);
    expect(convertValue(-40, "degC", "degF")).toBeCloseTo(-40, 9); // the crossover point
  });
  it("C ↔ K", () => {
    expect(convertValue(0, "degC", "K")).toBeCloseTo(273.15, 9);
    expect(convertValue(0, "K", "degC")).toBeCloseTo(-273.15, 9);
  });
});

describe("convertValue — same-unit identity", () => {
  it("linear unit: m → m", () => {
    expect(convertValue(1, "m", "m")).toBeCloseTo(1, 9);
    expect(convertValue(0, "m", "m")).toBe(0);
    expect(convertValue(-5, "km", "km")).toBeCloseTo(-5, 9);
  });
  it("temperature: C → C", () => {
    expect(convertValue(100, "degC", "degC")).toBeCloseTo(100, 9);
    expect(convertValue(-40, "degC", "degC")).toBeCloseTo(-40, 9);
  });
});

describe("convertValue — angle", () => {
  it("180 deg = π rad", () => {
    expect(convertValue(180, "deg", "rad")).toBeCloseTo(Math.PI, 10);
  });
  it("π rad = 180 deg", () => {
    expect(convertValue(Math.PI, "rad", "deg")).toBeCloseTo(180, 8);
  });
  it("200 grad = π rad", () => {
    expect(convertValue(200, "grad", "rad")).toBeCloseTo(Math.PI, 10);
  });
});

describe("convertValue — area", () => {
  it("1 m2 = 10000 cm2", () => {
    expect(convertValue(1, "m2", "cm2")).toBeCloseTo(10000, 4);
  });
  it("1 ha = 10000 m2", () => {
    expect(convertValue(1, "ha", "m2")).toBeCloseTo(10000, 6);
  });
});

describe("convertValue — speed", () => {
  it("1 ms1 = 3.6 kmh", () => {
    expect(convertValue(1, "ms1", "kmh")).toBeCloseTo(3.6, 6);
  });
});

describe("convertValue — guards", () => {
  it("returns null across incompatible categories", () => {
    expect(convertValue(1, "km", "kg")).toBeNull();
    expect(convertValue(1, "degC", "m")).toBeNull();
  });
  it("returns null for unknown unit keys", () => {
    expect(convertValue(1, "km", "nonsense")).toBeNull();
    expect(convertValue(1, "???", "m")).toBeNull();
  });
  it("round-trips back to the original value", () => {
    const there = convertValue(5, "mi", "km")!;
    expect(convertValue(there, "km", "mi")).toBeCloseTo(5, 9);
  });
});

describe("ConvertNode — scalar/list error consistency", () => {
  it("converts a scalar and a list element-wise, TAGGING the result (FC A4 value-mutating)", () => {
    // Convert now AUTHORS the value's unit: its output is a base-SI UnitCell tagged
    // with toUnit's dimension + display. 1 km → mi is base 1000 m, display "mi"
    // (its display magnitude in miles is 0.621371).
    const scalar = new ConvertNode({ fromUnit: "km", toUnit: "mi" }).data({ in: [1] }).out as UnitCell;
    expect(isUnitCell(scalar)).toBe(true);
    expect(scalar.dim).toEqual({ length: 1 });
    expect(scalar.display).toBe("mi");
    expect(scalar.value / CONVERT_UNIT_DEFS.mi.dim.scale).toBeCloseTo(0.621371, 5);
    // km → m of [1, 2] → base meters [1000, 2000], each tagged length + display "m".
    const list = new ConvertNode({ fromUnit: "km", toUnit: "m" }).data({ in: [[1, 2]] }).out as UnitCell[];
    expect(list.map((c) => magnitudeOf(c))).toEqual([1000, 2000]);
    expect(list.every((c) => dimOf(c).length === 1 && c.display === "m")).toBe(true);
  });
  it("cross-family conversion is a whole-value #N/A at every dimensionality", () => {
    // It's the NODE's unit pick, not a per-cell condition — so a scalar and a
    // whole list both become a single #N/A (not a list of per-cell errors).
    const scalar = new ConvertNode({ fromUnit: "km", toUnit: "kg" }).data({ in: [1] }).out;
    expect(isSolError(scalar) && scalar.code === "#N/A").toBe(true);
    const list = new ConvertNode({ fromUnit: "km", toUnit: "kg" }).data({ in: [[1, 2, 3]] }).out;
    expect(isSolError(list) && list.code === "#N/A").toBe(true);
  });
  it("an unknown unit id is the same whole-value #N/A, never #OVERFLOW!", () => {
    for (const [from, to] of [["furlong", "m"], ["km", "furlong"]]) {
      for (const input of [1, [1, 2], cellOf(1)]) {
        const out = new ConvertNode({ fromUnit: from, toUnit: to }).data({ in: [input] }).out;
        expect(isSolError(out) && out.code, `${from} → ${to}`).toBe("#N/A");
      }
    }
  });
});

function cellOf(v: number): UnitCell {
  return new ConvertNode({ fromUnit: "m", toUnit: "m" }).data({ in: [v] }).out as UnitCell;
}

describe("Convert and the FC share one unit id space ([[C25]] firstClassUnits)", () => {
  const sameUnit = (a: Unit, b: Unit) =>
    dimEqual(a.dim, b.dim) && Math.abs(a.scale / b.scale - 1) < 1e-9 && Math.abs((a.offset ?? 0) - (b.offset ?? 0)) < 1e-9;
  it("a Convert unit the FC also lists has the FC's id", () => {
    for (const [id, def] of Object.entries(CONVERT_UNIT_DEFS)) {
      const twin = UNIT_ANNOTATIONS.find((a) => { const u = fcUnitToUnit(a.id); return u !== null && sameUnit(u, def.dim); });
      if (twin) expect(id, def.label).toBe(twin.id);
    }
  });
  it("a Convert to km/h tags its output in km/h, and the unit flows on", () => {
    const n = new ConvertNode({ fromUnit: "ms1", toUnit: "kmh" });
    const r = n.data({ in: [1] }).out as UnitCell;
    expect(r.display).toBe("kmh");
    expect(n.unit).toBe("kmh");
  });
  it("the CONVERT formula reads Excel's codes, or else Convert's ids", () => {
    const ev = (e: string) => compileEvaluator(e)!({});
    expect(ev('CONVERT(100, "C", "F")')).toBeCloseTo(212, 9);
    expect(ev('CONVERT(1, "lbm", "kg")')).toBeCloseTo(0.45359237, 9);
    expect(ev('CONVERT(1, "oz", "ml")')).toBeCloseTo(29.5735295625, 6); // the fluid ounce
    expect(ev('CONVERT(36, "kmh", "ms1")')).toBeCloseTo(10, 9);
    expect(isSolError(ev('CONVERT(1, "toString", "m")'))).toBe(true);
  });
});
