// [[C25]] firstClassUnits
import { describe, it, expect } from "vitest";
import { dimPow, dimEqual, isDimensionless, formatDim, DIMENSIONLESS, type Unit } from "../../src/graph/dimension";
import { fcUnitToUnit } from "../../src/graph/dimension";

/** `value` in unit `a` read in unit `b`, or null across dimensions. */
function convert(value: number, a: Unit, b: Unit): number | null {
  if (!dimEqual(a.dim, b.dim)) return null;
  const out = (value * a.scale + (a.offset ?? 0) - (b.offset ?? 0)) / b.scale;
  return Number.isFinite(out) ? out : null;
}

const u = (s: string): Unit => {
  const p = fcUnitToUnit(s);
  if (!p) throw new Error(`unparseable test unit: ${s}`);
  return p;
};

describe("dimension-vector checks", () => {
  it("power scales the exponents", () => {
    expect(dimPow({ length: 1, time: -1 }, 2)).toEqual({ length: 2, time: -2 });
  });
  it("dimEqual treats a missing key as exponent 0", () => {
    expect(dimEqual({ length: 1, time: 0 }, { length: 1 })).toBe(true);
    expect(dimEqual({ length: 1 }, { length: 2 })).toBe(false);
    expect(isDimensionless({ length: 0 })).toBe(true);
  });
});

describe("conversion (matches the Convert node's contract)", () => {
  it("linear length/mass/time", () => {
    expect(convert(1, u("km"), u("m"))).toBeCloseTo(1000, 9);
    expect(convert(1, u("mi"), u("km"))).toBeCloseTo(1.609344, 6);
    expect(convert(1, u("kg"), u("g"))).toBeCloseTo(1000, 9);
    expect(convert(1, u("lb"), u("kg"))).toBeCloseTo(0.45359237, 8);
    expect(convert(1, u("h"), u("min"))).toBeCloseTo(60, 9);
  });
  it("angle: 180 deg = π rad", () => {
    expect(convert(180, u("deg"), u("rad"))).toBeCloseTo(Math.PI, 10);
  });
  it("affine temperature C↔F↔K", () => {
    expect(convert(100, fcUnitToUnit("degC")!, fcUnitToUnit("degF")!)).toBeCloseTo(212, 9);
    expect(convert(32, fcUnitToUnit("degF")!, fcUnitToUnit("degC")!)).toBeCloseTo(0, 9);
    expect(convert(-40, fcUnitToUnit("degC")!, fcUnitToUnit("degF")!)).toBeCloseTo(-40, 9);
    expect(convert(0, fcUnitToUnit("degC")!, fcUnitToUnit("K")!)).toBeCloseTo(273.15, 9);
    expect(convert(0, fcUnitToUnit("K")!, fcUnitToUnit("degC")!)).toBeCloseTo(-273.15, 9);
  });
  it("compound units convert: 1 m/s = 3.6 km/h", () => {
    expect(convert(1, u("m/s"), u("km/h"))).toBeCloseTo(3.6, 9);
  });
  it("area as length² is commensurable and converts: 1 m^2 = 10000 cm^2", () => {
    expect(convert(1, u("m^2"), u("cm^2"))).toBeCloseTo(10000, 6);
    expect(convert(1, u("m2"), u("cm2"))).toBeCloseTo(10000, 6); // trailing-digit power
  });
  it("incommensurable units return null (→ #UNIT!)", () => {
    expect(convert(1, u("km"), u("kg"))).toBeNull();
    expect(convert(1, u("m"), u("s"))).toBeNull();
  });
  it("round-trips within float precision", () => {
    const there = convert(5, u("mi"), u("km"))!;
    expect(convert(there, u("km"), u("mi"))).toBeCloseTo(5, 9);
  });
});

describe("unit expressions, read on the core", () => {
  it("bare symbols, prefixes, and litre special-case", () => {
    expect(fcUnitToUnit("m")!.dim).toEqual({ length: 1 });
    expect(fcUnitToUnit("km")!.scale).toBeCloseTo(1000, 9);
    expect(fcUnitToUnit("ms")!.scale).toBeCloseTo(0.001, 12); // milli-second
    expect(fcUnitToUnit("L")!.dim).toEqual({ length: 3 });
  });
  it("products, quotients, powers", () => {
    expect(fcUnitToUnit("m/s")!.dim).toEqual({ length: 1, time: -1 });
    expect(fcUnitToUnit("kg*m/s^2")!.dim).toEqual({ mass: 1, length: 1, time: -2 });
    expect(fcUnitToUnit("m^2")!.dim).toEqual({ length: 2 });
    expect(fcUnitToUnit("s^-1")!.dim).toEqual({ time: -1 });
  });
  it("rejects the unrecognized", () => {
    expect(fcUnitToUnit("bananas")).toBeNull();
    expect(fcUnitToUnit("m/s/kg")).toBeNull(); // two slashes
    expect(fcUnitToUnit("")).toBeNull();
  });
});

describe("derived-unit formatting", () => {
  it("names exact derived matches", () => {
    expect(formatDim({ mass: 1, length: 2, time: -2 })).toBe("J");
    expect(formatDim({ mass: 1, length: 2, time: -3 })).toBe("W");
    expect(formatDim({ mass: 1, length: -1, time: -2 })).toBe("Pa");
    expect(formatDim({ time: -1 })).toBe("Hz");
  });
  it("falls back to a base-symbol product with a / for negatives", () => {
    expect(formatDim({ length: 1, time: -1 })).toBe("m/s");
    expect(formatDim({ length: 2 })).toBe("m^2");
    expect(formatDim({ length: 1, time: -2 })).toBe("m/s^2");
  });
  it("dimensionless renders empty", () => {
    expect(formatDim(DIMENSIONLESS)).toBe("");
  });
});
