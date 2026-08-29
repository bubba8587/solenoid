import { describe, it, expect } from "vitest";
import { isLight, pickTextColor } from "./hicColors";

describe("hicColors", () => {
  it("pickTextColor contrasts the background (the white-on-white fix)", () => {
    // light card body → dark text (was the bug: white text on white)
    expect(isLight(pickTextColor(0xffffff))).toBe(false);
    expect(isLight(0xf5f5f5)).toBe(true); // near-white still counts as light
    // dark card body → light text
    expect(isLight(pickTextColor(0x1b1e25))).toBe(true);
  });
});
