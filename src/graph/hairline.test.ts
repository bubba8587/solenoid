import { describe, it, expect } from "vitest";
import { hairlineFor } from "./hairline";

describe("hairlineFor", () => {
  it("is exactly 1px at 100% zoom on every dpr, so the card is unchanged there", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3]) expect(hairlineFor(1, dpr)).toBe(1);
  });

  it("never goes below 1px, however far the camera zooms IN", () => {
    for (const k of [1.5, 2, 4, 10]) expect(hairlineFor(k, 1)).toBe(1);
    expect(hairlineFor(4, 3)).toBe(1);
  });

  it("holds at least one device pixel of ink when zoomed OUT", () => {
    for (const k of [0.9, 0.75, 0.6, 0.424, 0.3, 0.1]) {
      for (const dpr of [1, 1.5, 2, 3]) {
        // The quantum can round down by at most half a step.
        expect(hairlineFor(k, dpr) * k * dpr).toBeGreaterThan(0.85);
      }
    }
  });

  it("scales with the device pixel ratio — a denser display needs less width", () => {
    // Below the 1px floor on every dpr, so the ordering is the rule and not the clamp.
    expect(hairlineFor(0.25, 1)).toBeGreaterThan(hairlineFor(0.25, 2));
    expect(hairlineFor(0.25, 2)).toBeGreaterThan(hairlineFor(0.25, 3));
  });

  it("quantizes to 1/4px so a smooth zoom republishes rarely", () => {
    for (const k of [0.41, 0.42, 0.43, 0.317, 0.29]) {
      expect(hairlineFor(k, 1) * 4).toBe(Math.round(hairlineFor(k, 1) * 4));
    }
  });

  it("falls back to 1px on a degenerate scale rather than dividing by zero", () => {
    expect(hairlineFor(0, 1)).toBe(1);
    expect(hairlineFor(-1, 1)).toBe(1);
    expect(hairlineFor(1, 0)).toBe(1);
  });
});
