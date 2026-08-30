import { describe, it, expect } from "vitest";
import { findUpstreamLeaves, rankTornado } from "../../src/graph/tornadoRun";
import { NumberInputNode, SliderInputNode } from "../../src/graph/nodes/input";
import type { TornadoResult } from "../../src/graph/nodes/tornado";

// Regression: a Slider carries its own min/max/step input sockets, so the old
// leaf gate (`!hasInputs && instanceof SliderInputNode`) never matched it and the
// sweep walked straight past — Tornado ignored every Slider. A Number/Slider is
// the perturbable leaf regardless of its config sockets.

type Conn = { source: string; target: string };

function fakeEditor(nodes: Record<string, unknown>, connections: Conn[]) {
  return {
    getConnections: () => connections,
    getNode: (id: string) => nodes[id],
  } as unknown as Parameters<typeof findUpstreamLeaves>[0];
}

describe("findUpstreamLeaves", () => {
  it("recognizes a Slider feeding the target (despite its min/max/step sockets)", () => {
    const slider = new SliderInputNode({ label: "Growth" });
    const nodes = { slider, tornado: {} };
    const leaves = findUpstreamLeaves(fakeEditor(nodes, [{ source: "slider", target: "tornado" }]), "tornado");
    expect(leaves.map((l) => l.label)).toEqual(["Growth"]);
    expect(leaves[0].node).toBe(slider);
  });

  it("recognizes both a Number and a Slider, and does not walk past the slider's bounds", () => {
    const num = new NumberInputNode({ label: "Base" });
    const slider = new SliderInputNode({ label: "Rate" });
    // A Number driving the slider's `min` — the walk must STOP at the slider, so
    // this upstream number is NOT swept (perturbing it changes the range, not value).
    const boundSource = new NumberInputNode({ label: "MinFeed" });
    const nodes = { num, slider, boundSource, tornado: {} };
    const leaves = findUpstreamLeaves(
      fakeEditor(nodes, [
        { source: "num", target: "tornado" },
        { source: "slider", target: "tornado" },
        { source: "boundSource", target: "slider" },
      ]),
      "tornado",
    );
    expect(leaves.map((l) => l.label).sort()).toEqual(["Base", "Rate"]);
  });

  it("walks THROUGH a non-input producer to reach the leaves behind it", () => {
    const slider = new SliderInputNode({ label: "Rate" });
    // A stand-in transform node (has an input, isn't a Number/Slider).
    const transform = { inputs: { in: {} } };
    const nodes = { slider, transform, tornado: {} };
    const leaves = findUpstreamLeaves(
      fakeEditor(nodes, [
        { source: "transform", target: "tornado" },
        { source: "slider", target: "transform" },
      ]),
      "tornado",
    );
    expect(leaves.map((l) => l.label)).toEqual(["Rate"]);
  });
});

// Task 3 (Stream D): the tornado keeps RAW swing as the ranking key (traditional,
// author's lean) but no longer silently drops a leaf that diverges at an extreme —
// diverged leaves are kept and surfaced at the top, marked.
describe("rankTornado", () => {
  const r = (label: string, low: number, high: number, diverged = false): TornadoResult =>
    ({ nodeId: label, label, base: 0, low, high, inputLow: 0, inputHigh: 1, basis: "number", diverged });

  it("orders finite leaves by RAW swing, biggest first (not normalized by width)", () => {
    const ranked = rankTornado([r("small", 0, 2), r("big", -5, 5), r("mid", 0, 4)]);
    expect(ranked.map((x) => x.label)).toEqual(["big", "mid", "small"]);
  });

  it("keeps a diverged leaf and surfaces it at the TOP, marked", () => {
    const ranked = rankTornado([r("finite", 0, 3), r("blows-up", 0, Infinity, true)]);
    expect(ranked.map((x) => x.label)).toEqual(["blows-up", "finite"]);
    expect(ranked[0].diverged).toBe(true);
  });

  it("does not let a diverged (NaN swing) leaf corrupt the finite ordering", () => {
    const ranked = rankTornado([r("a", 0, 1), r("nan", NaN, NaN, true), r("b", 0, 10)]);
    // Diverged first, then finite by swing.
    expect(ranked.map((x) => x.label)).toEqual(["nan", "b", "a"]);
  });
});
