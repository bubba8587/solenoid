import { describe, it, expect } from "vitest";
import {
  dimMul, dimDiv, dimPow, dimEqual, isDimensionless,
  unitMul, unitDiv, unitPow, commensurable, convert,
  parseUnit, formatDim, UNITS, DIMENSIONLESS,
  type Unit,
} from "./dimension";

const u = (s: string): Unit => {
  const p = parseUnit(s);
  if (!p) throw new Error(`unparseable test unit: ${s}`);
  return p;
};

describe("dimension-vector algebra", () => {
  it("multiply adds exponents, divide subtracts, power scales", () => {
    expect(dimMul({ length: 1 }, { length: 1 })).toEqual({ length: 2 });
    expect(dimDiv({ length: 1 }, { time: 1 })).toEqual({ length: 1, time: -1 });
    expect(dimPow({ length: 1, time: -1 }, 2)).toEqual({ length: 2, time: -2 });
  });
  it("cancellation drops a zeroed dimension", () => {
    expect(dimDiv({ length: 1 }, { length: 1 })).toEqual({});
    expect(isDimensionless(dimDiv({ length: 1 }, { length: 1 }))).toBe(true);
  });
  it("dimEqual treats a missing key as exponent 0", () => {
    expect(dimEqual({ length: 1, time: 0 }, { length: 1 })).toBe(true);
    expect(dimEqual({ length: 1 }, { length: 2 })).toBe(false);
  });
});

describe("unit algebra — 5 m ÷ 1 s = 5 m/s (the headline)", () => {
  it("dividing meters by seconds yields a speed dimension", () => {
    const speed = unitDiv(UNITS.m, UNITS.s)!;
    expect(speed.dim).toEqual({ length: 1, time: -1 });
    expect(formatDim(speed.dim)).toBe("m/s");
  });
  it("force = mass × acceleration lands on newtons", () => {
    const accel = unitDiv(UNITS.m, unitMul(UNITS.s, UNITS.s)!)!; // m/s^2
    const force = unitMul(UNITS.kg, accel)!;
    expect(dimEqual(force.dim, UNITS.N.dim)).toBe(true);
    expect(formatDim(force.dim)).toBe("N");
  });
  it("an affine unit (°C) can't be multiplied", () => {
    expect(unitMul(UNITS.degC, UNITS.m)).toBeNull();
    expect(unitPow(UNITS.degC, 2)).toBeNull();
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
    expect(convert(100, UNITS.degC, UNITS.degF)).toBeCloseTo(212, 9);
    expect(convert(32, UNITS.degF, UNITS.degC)).toBeCloseTo(0, 9);
    expect(convert(-40, UNITS.degC, UNITS.degF)).toBeCloseTo(-40, 9);
    expect(convert(0, UNITS.degC, UNITS.K)).toBeCloseTo(273.15, 9);
    expect(convert(0, UNITS.K, UNITS.degC)).toBeCloseTo(-273.15, 9);
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
    expect(commensurable(u("m"), u("s"))).toBe(false);
    expect(commensurable(u("m/s"), u("km/h"))).toBe(true);
  });
  it("round-trips within float precision", () => {
    const there = convert(5, u("mi"), u("km"))!;
    expect(convert(there, u("km"), u("mi"))).toBeCloseTo(5, 9);
  });
});

describe("unit-expression parser", () => {
  it("bare symbols, prefixes, and litre special-case", () => {
    expect(parseUnit("m")!.dim).toEqual({ length: 1 });
    expect(parseUnit("km")!.scale).toBeCloseTo(1000, 9);
    expect(parseUnit("ms")!.scale).toBeCloseTo(0.001, 12); // milli-second
    expect(parseUnit("L")!.dim).toEqual({ length: 3 });
  });
  it("products, quotients, powers", () => {
    expect(parseUnit("m/s")!.dim).toEqual({ length: 1, time: -1 });
    expect(parseUnit("kg*m/s^2")!.dim).toEqual({ mass: 1, length: 1, time: -2 });
    expect(parseUnit("m^2")!.dim).toEqual({ length: 2 });
    expect(parseUnit("s^-1")!.dim).toEqual({ time: -1 });
  });
  it("rejects the unrecognized", () => {
    expect(parseUnit("bananas")).toBeNull();
    expect(parseUnit("m/s/kg")).toBeNull(); // two slashes
    expect(parseUnit("")).toBeNull();
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
    expect(formatDim({})).toBe("");
  });
});
