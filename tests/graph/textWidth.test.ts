// [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { textWidth } from "../../src/graph/textWidth";
import { FONT_VERSIONS } from "../../src/graph/textWidths.gen";

describe("textWidth", () => {
  it("matches Chromium's measurement of the bundled fonts", () => {
    // Measured with canvas measureText in the running app, fonts loaded.
    expect(textWidth("Northern hemisphere sales", { px: 9 })).toBeCloseTo(107.51, 0);
    expect(textWidth("DeepSeek-R1", { px: 9, weight: 600 })).toBeCloseTo(54.29, 1);
    expect(textWidth("12,345.67 USD", { px: 9 })).toBeCloseTo(58.43, 1);
    expect(textWidth("0123456789", { px: 13, mono: true })).toBeCloseTo(82.16, 1);
  });
  it("grows with weight and treats an unknown character as an average letter", () => {
    expect(textWidth("Wide", { px: 10, weight: 700 })).toBeGreaterThan(textWidth("Wide", { px: 10 }));
    expect(textWidth("漢", { px: 10 })).toBe(textWidth("n", { px: 10 }));
  });
  it("was generated from the fonts the app ships; rerun scripts/gen-text-widths.py after a font upgrade", () => {
    for (const [pkg, version] of Object.entries(FONT_VERSIONS)) {
      const installed = JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, "utf8")).version;
      expect(`${pkg}@${installed}`).toBe(`${pkg}@${version}`);
    }
  });
});
