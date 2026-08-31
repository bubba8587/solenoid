import { describe, it, expect } from "vitest";
import { axisTick, toSeries } from "../../../src/graph/components/chartCore";
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
    expect(axisTick(-Infinity)).toBe("");
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
