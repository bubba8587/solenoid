// [[C118]] formatTravelsWithValue, [[D94]] oneNumberDisplay
import { describe, it, expect } from "vitest";
import { formatScalar } from "../../../src/graph/components/format";
import { settingsStore } from "../../../src/graph/settingsStore";
import { formatAnnotationStore } from "../../../src/graph/formatAnnotationStore";
import { frameFormatStore } from "../../../src/graph/frameFormatStore";

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

  it("non-integers show the Decimal places setting, 4 by default, with trailing zeros dropped", () => {
    expect(formatScalar(3.14159265)).toBe("3.1416");
    expect(formatScalar(0.1)).toBe("0.1");
    expect(formatScalar(-2.5)).toBe("-2.5");
    expect(formatScalar(0.22033898305084745)).toBe("0.2203");
    expect(formatScalar(1234.56789)).toBe("1234.5679");
    expect(formatScalar(-0.00004)).toBe("-4e-5");
  });

  it("a value below the smallest shown decimal goes scientific, never 0", () => {
    expect(formatScalar(0.0001)).toBe("0.0001");
    expect(formatScalar(0.00001)).toBe("1e-5");
  });

  it("the setting moves the decimals and the scientific cut-off, and redraws the format stores", () => {
    const before = [formatAnnotationStore.version(), frameFormatStore.version()];
    settingsStore.set("numberDecimals", "2");
    try {
      expect(formatScalar(0.22033898)).toBe("0.22");
      expect(formatScalar(0.005)).toBe("5e-3");
      expect(formatAnnotationStore.version()).toBeGreaterThan(before[0]);
      expect(frameFormatStore.version()).toBeGreaterThan(before[1]);
    } finally {
      settingsStore.set("numberDecimals", "4");
    }
    expect(formatScalar(0.22033898)).toBe("0.2203");
  });

  it("Infinity renders as the ∞ glyph (tree/specs/values/value-semantics.md, author call 2026-08-05)", () => {
    expect(formatScalar(Infinity)).toBe("∞");
    expect(formatScalar(-Infinity)).toBe("-∞");
  });

  it("-0 is an integer and renders as '0'", () => {
    expect(formatScalar(-0)).toBe("0");
  });
});
