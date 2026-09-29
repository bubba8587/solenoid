// [[C94]] formatFamilyGates, [[D94]] oneNumberDisplay
import { describe, it, expect } from "vitest";
import { formatScalar } from "../../../src/graph/components/format";

// ─── formatScalar ────────────────────────────────────────────────────────────

describe("formatScalar", () => {
  it("NaN → 'NaN' (dirty data, not the #N/A error)", () => {
    expect(formatScalar(NaN)).toBe("NaN");
  });

  it("integers are rendered without a decimal point", () => {
    expect(formatScalar(0)).toBe("0");
    expect(formatScalar(1)).toBe("1");
    expect(formatScalar(-42)).toBe("-42");
    expect(formatScalar(1000000)).toBe("1000000");
  });

  it("non-integers show 6 significant digits with trailing zeros dropped, the General style", () => {
    expect(formatScalar(3.14159265)).toBe("3.14159");
    expect(formatScalar(0.1)).toBe("0.1");
    expect(formatScalar(-2.5)).toBe("-2.5");
    expect(formatScalar(0.22033898305084745)).toBe("0.220339");
    expect(formatScalar(1234.56789)).toBe("1234.57");
  });

  it("small non-integers keep their digits down to 1e-4, then go scientific", () => {
    expect(formatScalar(0.0001)).toBe("0.0001");
    expect(formatScalar(0.000123456)).toBe("0.000123456");
    expect(formatScalar(0.00001)).toBe("1e-5");
  });

  it("Infinity renders as the ∞ glyph (tree/specs/values/value-semantics.md, author call 2026-08-05)", () => {
    expect(formatScalar(Infinity)).toBe("∞");
    expect(formatScalar(-Infinity)).toBe("-∞");
  });

  it("-0 is an integer and renders as '0'", () => {
    expect(formatScalar(-0)).toBe("0");
  });
});
