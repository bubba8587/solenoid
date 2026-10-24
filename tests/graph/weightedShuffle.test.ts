// [[B11]]
import { describe, it, expect } from "vitest";
import { ShuffleNode } from "../../src/graph/nodes/list";
import type { SolError } from "../../src/graph/errorValue";

const first = (list: unknown[], weights: number[]) => (new ShuffleNode().data({ list: [list], weights: [weights] }).result as unknown[])[0];

describe("weighted draw", () => {
  it("sinks a non-positive or non-finite weight to the end", () => {
    for (const w of [0, -3, NaN, Infinity]) expect(first(["A", "B"], [w, 1])).toBe("B");
  });

  it("P(element first) is proportional to its weight (np.random.choice p=)", () => {
    const N = 5000;
    let hits = 0;
    for (let t = 0; t < N; t++) if (first([0, 1, 2], [10, 1, 1]) === 0) hits++;
    // Expected P(0 first) = 10/12 ≈ 0.833.
    expect(hits / N).toBeGreaterThan(0.80);
    expect(hits / N).toBeLessThan(0.87);
  });
});

describe("ShuffleNode weights socket", () => {
  it("puts the only positive-weight element first; zero weights sink to the end", () => {
    const out = new ShuffleNode().data({ list: [["A", "B", "C"]], weights: [[0, 1, 0]] });
    // B is the only positive weight → B first; A,C (weight 0) → Infinity keys → after.
    expect((out.result as unknown[])[0]).toBe("B");
  });

  it("a weights list shorter than the list is #SHAPE!, not a silent uniform shuffle", () => {
    const out = new ShuffleNode().data({ list: [["A", "B", "C"]], weights: [[1, 2]] });
    expect((out.result as SolError).code).toBe("#SHAPE!");
    // A longer list is fine: the extra weights are ignored.
    const ok = new ShuffleNode().data({ list: [["A", "B"]], weights: [[0, 1, 5]] });
    expect((ok.result as unknown[])[0]).toBe("B");
  });

  it("unwired weights = a plain shuffle (a permutation of the input)", () => {
    const out = new ShuffleNode().data({ list: [["A", "B", "C", "D"]] });
    expect([...(out.result as unknown[])].sort()).toEqual(["A", "B", "C", "D"]);
  });
});
