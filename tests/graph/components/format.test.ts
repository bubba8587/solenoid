import { describe, it, expect } from "vitest";
import { formatScalar, listPreview, extremeSci } from "../../../src/graph/components/format";

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

  it("non-integers are fixed to 4 decimal places", () => {
    expect(formatScalar(3.14159)).toBe("3.1416");
    expect(formatScalar(0.1)).toBe("0.1000");
    expect(formatScalar(-2.5)).toBe("-2.5000");
    expect(formatScalar(1.23456789)).toBe("1.2346");
  });

  it("very small non-integers: 4 decimals down to 1e-4, then forced scientific", () => {
    expect(formatScalar(0.0001)).toBe("0.0001");
    // Below 1e-4 the fixed form lied ("0.0000") — now scientific (2026-07-16).
    expect(formatScalar(0.00001)).toBe("1e-5");
  });

  it("Infinity renders as the ∞ glyph (value-semantics.md, author call 2026-08-05)", () => {
    expect(formatScalar(Infinity)).toBe("∞");
    expect(formatScalar(-Infinity)).toBe("-∞");
  });

  it("-0 is an integer and renders as '0'", () => {
    expect(formatScalar(-0)).toBe("0");
  });
});

// ─── listPreview ─────────────────────────────────────────────────────────────

describe("listPreview", () => {
  it("empty array → '[ ]'", () => {
    expect(listPreview([])).toBe("[ ]");
  });

  it("integers are rendered without decimal points", () => {
    expect(listPreview([1, 2, 3])).toBe("[1, 2, 3]  (3)");
  });

  it("floats are fixed to 2 decimal places inside listPreview", () => {
    expect(listPreview([1.5, 2.75])).toBe("[1.50, 2.75]  (2)");
  });

  it("NaN entries render as 'NaN'", () => {
    expect(listPreview([NaN, 1])).toBe("[NaN, 1]  (2)");
  });

  it("exactly 4 elements — no ellipsis", () => {
    expect(listPreview([1, 2, 3, 4])).toBe("[1, 2, 3, 4]  (4)");
  });

  it("5+ elements — shows first 4 then ', …' and count", () => {
    expect(listPreview([1, 2, 3, 4, 5])).toBe("[1, 2, 3, 4, …]  (5)");
    expect(listPreview([1, 2, 3, 4, 5, 6, 7])).toBe("[1, 2, 3, 4, …]  (7)");
  });

  it("count in parens reflects total array length, not preview length", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const result = listPreview(arr);
    expect(result).toContain("(100)");
    expect(result).toContain("…");
  });

  it("single element — no ellipsis", () => {
    expect(listPreview([42])).toBe("[42]  (1)");
  });

  it("negative numbers", () => {
    expect(listPreview([-1, -2.5])).toBe("[-1, -2.50]  (2)");
  });
});

describe("forced scientific past the readable range (author 2026-07-16)", () => {
  it("extremeSci: >= 1e12 or nonzero < 1e-4; readable range untouched", () => {
    expect(extremeSci(1.6331e16)).toBe("1.6331e+16"); // a tan() spike
    expect(extremeSci(3.6e22)).toBe("3.6e+22");        // trailing zeros trimmed
    expect(extremeSci(-1e12)).toBe("-1e+12");
    expect(extremeSci(0.00005)).toBe("5e-5");
    expect(extremeSci(999_999_999_999)).toBeNull();    // just under the line
    expect(extremeSci(0.0001)).toBeNull();
    expect(extremeSci(0)).toBeNull();
    expect(extremeSci(Infinity)).toBeNull();           // ∞ keeps its own rendering
  });

  it("formatScalar routes extremes through it (no 17-digit walls, no 0.0000 lies)", () => {
    expect(formatScalar(1.6331e16)).toBe("1.6331e+16");
    expect(formatScalar(0.00005)).toBe("5e-5");
    expect(formatScalar(1234.5)).toBe("1234.5000");    // normal range unchanged
  });
});
