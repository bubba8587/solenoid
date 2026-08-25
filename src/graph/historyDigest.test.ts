import { describe, it, expect } from "vitest";
import { Presets as HistoryPresets } from "rete-history-plugin";
import { describeAction, digestHistory, type DigestLookup } from "./historyDigest";

const { AddNodeAction, RemoveNodeAction, DragNodeAction, AddConnectionAction, RemoveConnectionAction } = HistoryPresets.classic;

// Constructors mostly just store references — safe to pass minimal stubs for a
// pure-logic unit test, no real editor/area needed. DragNodeAction's constructor
// DOES read `area.nodeViews.get(nodeId)` immediately (to snapshot the "new"
// position), so the area stub needs a `nodeViews` Map (empty is fine — the ctor
// early-returns before setting prev/new, and describeAction only reads `nodeId`).
const stubEditor = {} as never;
const stubArea = { nodeViews: new Map() } as never;

const lookup: DigestLookup = {
  nodeName: (id) => ({ n1: "Sum", n2: "Display" } as Record<string, string>)[id],
};
const emptyLookup: DigestLookup = { nodeName: () => undefined };

describe("describeAction", () => {
  it("describes an AddNodeAction by its nodeId, resolved through the lookup", () => {
    const a = new AddNodeAction(stubEditor, stubArea, "n1");
    expect(describeAction(a, lookup)).toBe("Added node: Sum");
  });

  it("falls back to a generic phrase when the node is gone", () => {
    const a = new AddNodeAction(stubEditor, stubArea, "n404");
    expect(describeAction(a, lookup)).toBe("Added node: a node (removed)");
  });

  it("describes a RemoveNodeAction from the removed node's own label/type", () => {
    const removed = { label: "Total", constructor: { name: "ArithmeticNode" } };
    const a = new RemoveNodeAction(stubEditor, stubArea, removed as never, { x: 0, y: 0 });
    expect(describeAction(a, lookup)).toBe("Removed node: Total");
  });

  it("RemoveNodeAction falls back to the type name when unlabeled", () => {
    const removed = { label: "", constructor: { name: "ArithmeticNode" } };
    const a = new RemoveNodeAction(stubEditor, stubArea, removed as never, { x: 0, y: 0 });
    expect(describeAction(a, lookup)).toBe("Removed node: Add");
  });

  it("describes a DragNodeAction via its public nodeId", () => {
    const a = new DragNodeAction(stubArea, "n2", { x: 0, y: 0 });
    expect(describeAction(a, lookup)).toBe("Moved node: Display");
  });

  it("describes an AddConnectionAction as source → target", () => {
    const conn = { id: "c1", source: "n1", sourceOutput: "result", target: "n2", targetInput: "in" };
    const a = new AddConnectionAction(stubEditor, conn as never);
    expect(describeAction(a, lookup)).toBe("Connected Sum → Display");
  });

  it("describes a RemoveConnectionAction as source → target", () => {
    const conn = { id: "c1", source: "n1", sourceOutput: "result", target: "n2", targetInput: "in" };
    const a = new RemoveConnectionAction(stubEditor, conn as never);
    expect(describeAction(a, lookup)).toBe("Disconnected Sum → Display");
  });

  it("degrades to a generic phrase when nothing is resolvable", () => {
    const a = new AddNodeAction(stubEditor, stubArea, "n404");
    expect(describeAction(a, emptyLookup)).toBe("Added node: a node (removed)");
  });
});

describe("digestHistory", () => {
  it("reports no actions for an empty snapshot", () => {
    expect(digestHistory([], lookup)).toBe("No actions yet this session.");
  });

  it("prefixes each line with a time and groups under one date header", () => {
    const t0 = new Date("2026-07-03T10:00:00").getTime();
    const t1 = new Date("2026-07-03T10:05:00").getTime();
    const records = [
      { time: t0, action: new AddNodeAction(stubEditor, stubArea, "n1") },
      { time: t1, action: new DragNodeAction(stubArea, "n1", { x: 0, y: 0 }) },
    ];
    const out = digestHistory(records, lookup);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^— .+ —$/); // one date header
    expect(lines).toHaveLength(3); // header + 2 records
    expect(lines[1]).toContain("Added node: Sum");
    expect(lines[2]).toContain("Moved node: Sum");
  });
});
