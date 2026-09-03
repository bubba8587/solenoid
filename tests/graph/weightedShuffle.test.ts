import { describe, it, expect } from "vitest";
import { weightedShuffleKey, shuffleList } from "../../src/graph/nodes/listOps";
import { ShuffleNode } from "../../src/graph/nodes/list";

describe("weightedShuffleKey", () => {
  it("sinks a non-positive or non-finite weight to the end", () => {
    expect(weightedShuffleKey(0.5, 0)).toBe(Infinity);
    expect(weightedShuffleKey(0.5, -3)).toBe(Infinity);
    expect(weightedShuffleKey(0.5, NaN)).toBe(Infinity);
    expect(weightedShuffleKey(0.5, Infinity)).toBe(Infinity);
  });

  it("higher weight yields a smaller key for the same uniform (lands earlier)", () => {
    expect(weightedShuffleKey(0.5, 4)).toBeLessThan(weightedShuffleKey(0.5, 1));
  });

  it("equal uniforms sort by descending weight (via shuffleList's ascending keys)", () => {
    const keys = [4, 2, 1].map((w) => weightedShuffleKey(0.5, w));
    expect(shuffleList(["A", "B", "C"], keys)).toEqual(["A", "B", "C"]);
  });

  it("P(element first) is proportional to its weight (np.random.choice p=)", () => {
    const weights = [10, 1, 1];
    const N = 20000;
    const first = [0, 0, 0];
    for (let t = 0; t < N; t++) {
      const keys = weights.map((w) => weightedShuffleKey(Math.random(), w));
      first[shuffleList([0, 1, 2], keys)[0]]++;
    }
    // Expected P(0 first) = 10/12 ≈ 0.833.
    expect(first[0] / N).toBeGreaterThan(0.80);
    expect(first[0] / N).toBeLessThan(0.87);
  });
});

describe("ShuffleNode weights socket", () => {
  it("puts the only positive-weight element first; zero weights sink to the end", () => {
    const out = new ShuffleNode().data({ list: [["A", "B", "C"]], weights: [[0, 1, 0]] });
    // B is the only positive weight → B first; A,C (weight 0) → Infinity keys → after.
    expect(out.result[0]).toBe("B");
  });

  it("unwired weights = a plain shuffle (a permutation of the input)", () => {
    const out = new ShuffleNode().data({ list: [["A", "B", "C", "D"]] });
    expect([...out.result].sort()).toEqual(["A", "B", "C", "D"]);
  });
});
