import { describe, it, expect } from "vitest";
import { convertValue, CONVERT_UNIT_DEFS, ConvertNode } from "./convert";
import { isSolError } from "../errorValue";
import { isUnitCell, magnitudeOf, dimOf, type UnitCell } from "../unitValue";

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
    expect(convertValue(1, "gal", "l")).toBeCloseTo(3.785411784, 9);
    expect(convertValue(1, "atm", "Pa")).toBeCloseTo(101325, 6);
    expect(convertValue(1, "kcal", "cal")).toBeCloseTo(1000, 9);
  });
});

describe("convertValue — temperature (affine, not just a factor)", () => {
  it("C ↔ F", () => {
    expect(convertValue(100, "C", "F")).toBeCloseTo(212, 9);
    expect(convertValue(32, "F", "C")).toBeCloseTo(0, 9);
    expect(convertValue(-40, "C", "F")).toBeCloseTo(-40, 9); // the crossover point
  });
  it("C ↔ K", () => {
    expect(convertValue(0, "C", "K")).toBeCloseTo(273.15, 9);
    expect(convertValue(0, "K", "C")).toBeCloseTo(-273.15, 9);
  });
});

describe("convertValue — same-unit identity", () => {
  it("linear unit: m → m", () => {
    expect(convertValue(1, "m", "m")).toBeCloseTo(1, 9);
    expect(convertValue(0, "m", "m")).toBe(0);
    expect(convertValue(-5, "km", "km")).toBeCloseTo(-5, 9);
  });
  it("temperature: C → C", () => {
    expect(convertValue(100, "C", "C")).toBeCloseTo(100, 9);
    expect(convertValue(-40, "C", "C")).toBeCloseTo(-40, 9);
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
  it("1 m_s = 3.6 km_h", () => {
    expect(convertValue(1, "m_s", "km_h")).toBeCloseTo(3.6, 6);
  });
});

describe("CONVERT_UNIT_DEFS catalog", () => {
  it("every def has required fields and callable functions", () => {
    for (const [key, def] of Object.entries(CONVERT_UNIT_DEFS)) {
      expect(typeof def.label,     `${key}.label`).toBe("string");
      expect(typeof def.excelCode, `${key}.excelCode`).toBe("string");
      expect(typeof def.category,  `${key}.category`).toBe("string");
      expect(typeof def.toBase,    `${key}.toBase`).toBe("function");
      expect(typeof def.fromBase,  `${key}.fromBase`).toBe("function");
    }
  });
  it("linear units: fromBase(toBase(x)) round-trips within float precision", () => {
    const linearKeys = Object.keys(CONVERT_UNIT_DEFS).filter(k => k !== "C" && k !== "F" && k !== "K");
    for (const key of linearKeys) {
      const def = CONVERT_UNIT_DEFS[key];
      expect(def.fromBase(def.toBase(42))).toBeCloseTo(42, 8);
    }
  });
  it("temperature: C→F→C round-trips", () => {
    const fahr = CONVERT_UNIT_DEFS.F.fromBase(CONVERT_UNIT_DEFS.C.toBase(37));
    expect(CONVERT_UNIT_DEFS.C.fromBase(CONVERT_UNIT_DEFS.F.toBase(fahr))).toBeCloseTo(37, 8);
  });
});

describe("convertValue — guards", () => {
  it("returns null across incompatible categories", () => {
    expect(convertValue(1, "km", "kg")).toBeNull();
    expect(convertValue(1, "C", "m")).toBeNull();
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
    // km → m of [1, 2] → base metres [1000, 2000], each tagged length + display "m".
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
});
