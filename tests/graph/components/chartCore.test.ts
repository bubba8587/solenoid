// [[C100]] chartIsAValue, [[B2]] webTryDesktopFull, [[C24]]
import { describe, it, expect } from "vitest";
import { axisTick, compactTick, valueAxisWidth, toSeries, partSlices, spotlightIndex } from "../../../src/graph/components/chartCore";
import { solError } from "../../../src/graph/errorValue";

describe("axisTick", () => {
  it("snaps float / precision noise to the clean value (a 'really 3' reads as 3)", () => {
    expect(axisTick(3.0000000004)).toBe("3");
    expect(axisTick(2.9999999998)).toBe("3");
    expect(axisTick(0.1 + 0.2)).toBe("0.3"); // 0.30000000000000004
    expect(axisTick(3)).toBe("3");
    expect(axisTick(1234.5)).toBe("1234.5"); // no trailing zeros
    expect(axisTick(3.14159)).toBe("3.14159"); // real precision kept
  });
  it("returns empty string for non-finite", () => {
    expect(axisTick(NaN)).toBe("");
    expect(axisTick(Infinity)).toBe("");
  });
});

describe("compactTick", () => {
  it("keeps three significant figures and scales past a thousand, so a value axis fits its gutter", () => {
    expect(compactTick(0)).toBe("0");
    expect(compactTick(0.125)).toBe("0.125");
    expect(compactTick(800)).toBe("800");
    expect(compactTick(1500)).toBe("1.5K");
    expect(compactTick(150000)).toBe("150K");
    expect(compactTick(1234567)).toBe("1.23M");
    expect(compactTick(-2500000000)).toBe("-2.5B");
  });
  it("rounds before it picks the unit, so a value just under a boundary takes the next one", () => {
    expect(compactTick(999.5)).toBe("1K");
    expect(compactTick(999999)).toBe("1M");
    expect(compactTick(-999.7)).toBe("-1K");
    expect(compactTick(2.5e12)).toBe("2.5T");
  });
  it("returns empty string for non-finite", () => {
    expect(compactTick(NaN)).toBe("");
    expect(compactTick(Infinity)).toBe("");
  });
});

describe("valueAxisWidth", () => {
  it("keeps the 26 px gutter (40 with an axis title) while the ticks stay short", () => {
    expect(valueAxisWidth([1, 5, 80], 1)).toBe(26);
    expect(valueAxisWidth([1, 5, 80], 1, true)).toBe(40);
    expect(valueAxisWidth([], 1)).toBe(26);
  });
  it("measures the round ticks between the ends too: a 0–1 axis has 0.25", () => {
    expect(valueAxisWidth([0, 1], 1)).toBe(32);
  });
  it("grows to the widest end tick, rounded the way the axis rounds its ends", () => {
    expect(valueAxisWidth([120000, 176319], 1)).toBe(32); // ends at 180K
    expect(valueAxisWidth([-1234, 50], 1)).toBe(37); // starts at -1.2K
    expect(valueAxisWidth([1, 2, null, "x", NaN], 2)).toBe(43); // scales with the font
  });
});

describe("toSeries", () => {
  it("drops non-finite / error / null cells, keeping ORIGINAL indices (labels stay aligned)", () => {
    expect(toSeries([10, null, 30])).toEqual([{ i: 0, v: 10 }, { i: 2, v: 30 }]);
    expect(toSeries([1, NaN, Infinity, 4])).toEqual([{ i: 0, v: 1 }, { i: 3, v: 4 }]);
    expect(toSeries([1, solError("#DIV/0!", "x") as unknown as number, 3])).toEqual([{ i: 0, v: 1 }, { i: 2, v: 3 }]);
  });
  it("handles a scalar, null, and a bare error without throwing", () => {
    expect(toSeries(5)).toEqual([{ i: 0, v: 5 }]);
    expect(toSeries(null)).toEqual([]);
    expect(toSeries(solError("#DIV/0!", "x"))).toEqual([]);
  });
});

describe("partSlices", () => {
  it("a pie drops zero and negative slices and keeps each slice's row index", () => {
    expect(partSlices("pie", toSeries([10, -5, 0, 3]))).toEqual([{ i: 0, v: 10 }, { i: 3, v: 3 }]);
  });

  it("a funnel or radial drops a negative stage and keeps a zero one", () => {
    for (const op of ["funnel", "radialbar"] as const) {
      expect(partSlices(op, toSeries([10, -5, 0, 3]))).toEqual([{ i: 0, v: 10 }, { i: 2, v: 0 }, { i: 3, v: 3 }]);
    }
  });

  it("leaves an axis figure's series whole", () => {
    expect(partSlices("column", toSeries([10, -5]))).toEqual([{ i: 0, v: 10 }, { i: 1, v: -5 }]);
  });
});

describe("spotlightIndex", () => {
  it("keeps the picked series while it holds its slot", () => {
    expect(spotlightIndex({ index: 1, name: "b" }, ["a", "b", "c"])).toBe(1);
  });
  it("follows the picked name when the series reorder", () => {
    expect(spotlightIndex({ index: 2, name: "c" }, ["c", "a", "b"])).toBe(0);
  });
  it("drops a spotlight whose series is gone, so nothing dims", () => {
    expect(spotlightIndex({ index: 2, name: "c" }, ["a", "b"])).toBeNull();
  });
  it("drops a moved spotlight whose name is ambiguous", () => {
    expect(spotlightIndex({ index: 2, name: "" }, ["", ""])).toBeNull();
  });
});
