import { describe, it, expect } from "vitest";
import { formatScalar, listPreview } from "./format";

// ─── formatScalar ────────────────────────────────────────────────────────────

describe("formatScalar", () => {
  it("NaN → 'N/A'", () => {
    expect(formatScalar(NaN)).toBe("N/A");
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

  it("very small non-integers still get 4 decimal places", () => {
    expect(formatScalar(0.0001)).toBe("0.0001");
    expect(formatScalar(0.00001)).toBe("0.0000");
  });

  it("Infinity falls through to toFixed(4) → 'Infinity'", () => {
    // Number.isInteger(Infinity) is false; toFixed returns "Infinity" per spec
    expect(formatScalar(Infinity)).toBe("Infinity");
    expect(formatScalar(-Infinity)).toBe("-Infinity");
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

  it("NaN entries render as 'N/A'", () => {
    expect(listPreview([NaN, 1])).toBe("[N/A, 1]  (2)");
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
