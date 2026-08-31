import { describe, it, expect } from "vitest";
import { parseColor, toCss, mixSrgb, flowTint, type RGBA } from "../../src/graph/cssColor";

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
    expect(parseColor("rgb(1,2)")).toBeNull(); // too few
  });
});

describe("toCss", () => {
  it("rounds + clamps to an rgba() string", () => {
    expect(toCss({ r: 255.6, g: -3, b: 128.4, a: 1.2 })).toBe("rgba(255, 0, 128, 1)");
  });
});

describe("mixSrgb", () => {
  const black: RGBA = { r: 0, g: 0, b: 0, a: 1 };
  const white: RGBA = { r: 255, g: 255, b: 255, a: 1 };
  it("t=0 → a, t=1 → b", () => {
    expect(mixSrgb(black, white, 0)).toEqual(black);
    expect(mixSrgb(black, white, 1)).toEqual(white);
  });
  it("t=0.5 → midpoint", () => {
    expect(mixSrgb(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
  });
  it("clamps t", () => {
    expect(mixSrgb(black, white, 2)).toEqual(white);
    expect(mixSrgb(black, white, -1)).toEqual(black);
  });
});

describe("flowTint", () => {
  it("mixes base P% toward white (matches color-mix(in srgb, base P%, #fff))", () => {
    // base 100% → pure base.
    expect(flowTint("#3060c0", 100)).toBe("rgba(48, 96, 192, 1)");
    // base 0% → pure white.
    expect(flowTint("#3060c0", 0)).toBe("rgba(255, 255, 255, 1)");
    // base 85% (the cable flow value) → 0.15 toward white.
    const c = flowTint("#000000", 85); // 0.15*255 = 38.25 → 38
    expect(c).toBe("rgba(38, 38, 38, 1)");
  });
  it("falls back gracefully on an unparseable base", () => {
    expect(flowTint("var(--whatever)", 85)).toMatch(/^rgba\(/);
  });
});
