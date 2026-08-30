import { beforeEach, describe, expect, it, vi } from "vitest";
import { cableValueStore } from "../../src/graph/cableValueStore";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";

// Node-scoped forget and the id-prefix guard live in nodeStoreRegistry.test.ts,
// which drives this store for real. What is pinned HERE is this store's one
// unusual contract: writes are silent by design.
beforeEach(() => {
  forgetAllNodes();
});

describe("cableValueStore — set / get", () => {
  it("stores each output under nodeId:key, any value type, overwriting on re-set", () => {
    expect(cableValueStore.get("n1", "out")).toBeUndefined();
    cableValueStore.setNodeOutputs("n1", { arr: [1, 2, 3], nil: null, flag: false, out: 1 });
    cableValueStore.setNodeOutputs("n1", { out: 99 });
    cableValueStore.setNodeOutputs("n2", { out: 20 });
    expect(cableValueStore.get("n1", "arr")).toEqual([1, 2, 3]);
    expect(cableValueStore.get("n1", "nil")).toBeNull();
    expect(cableValueStore.get("n1", "flag")).toBe(false);
    expect(cableValueStore.get("n1", "out")).toBe(99);
    expect(cableValueStore.get("n2", "out")).toBe(20);
    expect(cableValueStore.get("n1", "other")).toBeUndefined();
  });
});

describe("cableValueStore — bump / subscribe / version", () => {
  it("bump bumps the version and notifies; unsubscribe stops delivery", () => {
    const fn = vi.fn();
    const unsub = cableValueStore.subscribe(fn);
    const v0 = cableValueStore.version();
    cableValueStore.bump();
    expect(cableValueStore.version()).toBe(v0 + 1);
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    cableValueStore.bump();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // The deliberate design: process.ts writes per compute, and notifying there
  // would thrash React — only the explicit end-of-pass bump() re-renders.
  it("setNodeOutputs and forget alone do NOT bump (writes are silent)", () => {
    const v0 = cableValueStore.version();
    cableValueStore.setNodeOutputs("n1", { out: 1 });
    cableValueStore.forget("n1");
    expect(cableValueStore.version()).toBe(v0);
  });
});
