import { describe, it, expect } from "vitest";
import { describeGraphDelta } from "./flowHistoryDigest";
import type { SavedGraph, SavedNode } from "../persistence";

const node = (id: string, name: string, extra: Partial<SavedNode> = {}): SavedNode => ({
  id,
  type: "NumberInputNode",
  name,
  x: 0,
  y: 0,
  init: {},
  ...extra,
});

const graph = (nodes: SavedNode[], connections: SavedGraph["connections"] = []): SavedGraph =>
  ({ v: 2, nodes, connections }) as SavedGraph;

const a = node("n1", "rate");
const b = node("n2", "total");

describe("describeGraphDelta", () => {
  it("names a single added node", () => {
    expect(describeGraphDelta(graph([a]), graph([a, b]))).toBe("Added node: total");
  });

  it("counts multiple added nodes", () => {
    expect(describeGraphDelta(graph([]), graph([a, b]))).toBe("Added 2 nodes");
  });

  it("names a removed node", () => {
    expect(describeGraphDelta(graph([a, b]), graph([a]))).toBe("Removed node: total");
  });

  it("names a single cable by its endpoints", () => {
    const conn = { source: "n1", sourceOutput: "value", target: "n2", targetInput: "a" };
    expect(describeGraphDelta(graph([a, b]), graph([a, b], [conn]))).toBe("Connected rate → total");
    expect(describeGraphDelta(graph([a, b], [conn]), graph([a, b]))).toBe("Disconnected rate → total");
  });

  it("reports a move only when nothing else changed", () => {
    const movedB = { ...b, x: 40 };
    expect(describeGraphDelta(graph([a, b]), graph([a, movedB]))).toBe("Moved node: total");
    expect(describeGraphDelta(graph([a]), graph([a, movedB].map((n) => n)))).toBe("Added node: total");
  });

  it("reports an in-card edit", () => {
    const editedA = { ...a, literals: { value: 7 } };
    expect(describeGraphDelta(graph([a]), graph([editedA]))).toBe("Edited node: rate");
  });

  it("ignores measured card dims (init.width/height settle after the baseline)", () => {
    const measured = { ...a, init: { label: "Rate", width: 240, height: 167 } };
    const settled = { ...a, init: { label: "Rate", width: 233, height: 139 } };
    expect(describeGraphDelta(graph([measured]), graph([settled]))).toBe("Edited document");
  });

  it("reports a rename with both names", () => {
    const renamedA = { ...a, name: "apr" };
    expect(describeGraphDelta(graph([a]), graph([renamedA]))).toBe("Renamed rate → apr");
  });

  it("joins compound changes, most significant first", () => {
    const conn = { source: "n1", sourceOutput: "value", target: "n2", targetInput: "a" };
    expect(describeGraphDelta(graph([a]), graph([a, b], [conn]))).toBe(
      "Added node: total; Connected rate → total",
    );
  });

  it("falls back for changes outside nodes and cables", () => {
    const prev = graph([a]);
    const next: SavedGraph = {
      ...graph([a]),
      standoffs: [
        { a: { nodeId: "n1", anchor: "w" }, b: { nodeId: "n2", anchor: "w" }, min: 0, max: 10 },
      ],
    };
    expect(describeGraphDelta(prev, next)).toBe("Changed standoffs");
  });
});
