// [[C62]] paletteAllOrNone
import { describe, it, expect } from "vitest";
import { parseColor } from "../../src/graph/cssColor";

describe("parseColor", () => {
  it("parses #rrggbb", () => {
    expect(parseColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor("#56b4e9")).toEqual({ r: 0x56, g: 0xb4, b: 0xe9, a: 1 });
  });

  it("parses shorthand #rgb and #rgba", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#f00f")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("parses #rrggbbaa alpha", () => {
    const c = parseColor("#ff000080")!;
    expect(c.r).toBe(255);
    expect(c.a).toBeCloseTo(128 / 255, 6);
  });

  it("parses rgb() and rgba()", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it("is whitespace tolerant", () => {
    expect(parseColor("  #abc  ")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  });

  it("parses the modern color(srgb …) form Chrome returns for color-mix values", () => {
    // 0.298039 * 255 ≈ 76, 0.545098 * 255 ≈ 139, 0.960784 * 255 ≈ 245
    const c = parseColor("color(srgb 0.298039 0.545098 0.960784 / 0.78)")!;
    expect(c.r).toBe(76); expect(c.g).toBe(139); expect(c.b).toBe(245);
    expect(c.a).toBeCloseTo(0.78, 5);
    // no alpha → opaque
    expect(parseColor("color(srgb 1 0 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("returns null for unsupported forms (named/hsl/var/color-mix)", () => {
    expect(parseColor("red")).toBeNull();
    expect(parseColor("hsl(0,100%,50%)")).toBeNull();
    expect(parseColor("var(--x)")).toBeNull();
    expect(parseColor("color-mix(in srgb, #fff 50%, #000)")).toBeNull();
    expect(parseColor("#ff")).toBeNull();      // bad length
    expect(parseColor("#112233zz")).toBeNull(); // bad alpha digits
    expect(parseColor("rgb(1,2)")).toBeNull(); // too few
  });
});
