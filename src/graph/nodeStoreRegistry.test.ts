import { describe, it, expect, vi } from "vitest";
import { registerNodeForget, forgetNode, forgetAllNodes } from "./nodeStoreRegistry";
import { collapseStore } from "./collapseStore";
import { nodeSizeStore } from "./nodeSizeStore";
import { cableValueStore } from "./cableValueStore";
import { cableAngleStore } from "./cableAngleStore";

describe("nodeStoreRegistry", () => {
  it("calls every registered forgetter with the deleted node id", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerNodeForget(a);
    registerNodeForget(b);
    forgetNode("xyz");
    expect(a).toHaveBeenCalledWith("xyz");
    expect(b).toHaveBeenCalledWith("xyz");
  });

  it("forgets a node across all real node-keyed stores, leaving others intact", () => {
    // Two nodes' worth of UI state in each store.
    collapseStore.set("n1", true);
    collapseStore.set("n2", true);
    nodeSizeStore.set("n1", { w: 100, h: 50 });
    nodeSizeStore.set("n2", { w: 120, h: 60 });
    cableValueStore.setNodeOutputs("n1", { out: 5, extra: 7 });
    cableValueStore.setNodeOutputs("n2", { out: 9 });
    cableAngleStore.set("n1", "out", 90);
    cableAngleStore.set("n2", "out", 45);

    forgetNode("n1");

    // n1 is gone everywhere…
    expect(collapseStore.get("n1")).toBe(false);
    expect(nodeSizeStore.get("n1")).toBeUndefined();
    expect(cableValueStore.get("n1", "out")).toBeUndefined();
    expect(cableValueStore.get("n1", "extra")).toBeUndefined();
    expect(cableAngleStore.get("n1", "out")).toBeNull();

    // …n2 is untouched.
    expect(collapseStore.get("n2")).toBe(true);
    expect(nodeSizeStore.get("n2")).toEqual({ w: 120, h: 60 });
    expect(cableValueStore.get("n2", "out")).toBe(9);
    expect(cableAngleStore.get("n2", "out")).toBe(45);

    // cleanup so the shared module singletons don't bleed into other tests
    forgetNode("n2");
  });

  it("does not confuse ids that share a prefix (colon-delimited keys)", () => {
    cableValueStore.setNodeOutputs("node1", { v: 1 });
    cableValueStore.setNodeOutputs("node12", { v: 2 });
    cableAngleStore.set("node1", "v", 10);
    cableAngleStore.set("node12", "v", 20);

    forgetNode("node1");

    expect(cableValueStore.get("node1", "v")).toBeUndefined();
    expect(cableValueStore.get("node12", "v")).toBe(2); // not clobbered
    expect(cableAngleStore.get("node1", "v")).toBeNull();
    expect(cableAngleStore.get("node12", "v")).toBe(20);

    forgetNode("node12");
  });

  it("forgetAllNodes bulk-resets the scanning stores in one pass", () => {
    cableValueStore.setNodeOutputs("a", { out: 1 });
    cableValueStore.setNodeOutputs("b", { out: 2 });
    cableAngleStore.set("a", "out", 30);
    cableAngleStore.set("b", "out", 60);

    forgetAllNodes();

    expect(cableValueStore.get("a", "out")).toBeUndefined();
    expect(cableValueStore.get("b", "out")).toBeUndefined();
    expect(cableAngleStore.get("a", "out")).toBeNull();
    expect(cableAngleStore.get("b", "out")).toBeNull();
  });
});
