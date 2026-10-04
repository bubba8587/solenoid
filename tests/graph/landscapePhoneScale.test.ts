// [[C119]] landscapePhoneIsTablet
import { describe, it, expect } from "vitest";
import { landscapePhoneScale } from "../../src/graph/coarse";

describe("landscapePhoneScale", () => {
  it("lays a Galaxy S25+ out 1100 px wide, about the author's hand-set 75-80% zoom", () => {
    expect(landscapePhoneScale(832, 384 - 80)).toBeCloseTo(0.756, 3);
  });
  it("lets a short screen's height decide when it is the tighter fit", () => {
    expect(landscapePhoneScale(1000, 260)).toBeCloseTo(260 / 380, 3);
  });
  it("never scales up, and never below 0.6", () => {
    expect(landscapePhoneScale(1400, 600)).toBe(1);
    expect(landscapePhoneScale(500, 150)).toBe(0.6);
  });
});
