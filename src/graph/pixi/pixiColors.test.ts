import { describe, it, expect } from "vitest";
import { channels, perceivedLuminance, isLight, pickTextColor, insetShade, mix } from "./pixiColors";

describe("pixiColors", () => {
  it("splits channels", () => {
    expect(channels(0x112233)).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
  });

  it("luminance: white bright, black dark", () => {
    expect(perceivedLuminance(0xffffff)).toBeCloseTo(1);
    expect(perceivedLuminance(0x000000)).toBeCloseTo(0);
  });

  it("isLight discriminates", () => {
    expect(isLight(0xffffff)).toBe(true);
    expect(isLight(0xf5f5f5)).toBe(true);
    expect(isLight(0x000000)).toBe(false);
    expect(isLight(0x1b1e25)).toBe(false);
  });

  it("pickTextColor contrasts the background (the white-on-white fix)", () => {
    // light card body → dark text (was the bug: white text on white)
    expect(isLight(pickTextColor(0xffffff))).toBe(false);
    // dark card body → light text
    expect(isLight(pickTextColor(0x1b1e25))).toBe(true);
  });

  it("mix blends endpoints", () => {
    expect(mix(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mix(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080); // 128
  });

  it("insetShade stays close to the background", () => {
    const s = insetShade(0xffffff);
    // a slight darkening of white, not a wild colour
    expect(perceivedLuminance(s)).toBeLessThan(1);
    expect(perceivedLuminance(s)).toBeGreaterThan(0.85);
  });
});
