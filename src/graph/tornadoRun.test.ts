import { describe, it, expect } from "vitest";
import { findUpstreamLeaves } from "./tornadoRun";
import { NumberInputNode, SliderInputNode } from "./nodes/input";

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
