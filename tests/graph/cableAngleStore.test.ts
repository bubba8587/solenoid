import { beforeEach, describe, expect, it, vi } from "vitest";
import { cableAngleStore } from "../../src/graph/cableAngleStore";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";

// Node-scoped forget, cross-store forget, and the "::" prefix guard live in
// nodeStoreRegistry.test.ts, which drives this store for real.
beforeEach(() => {
  forgetAllNodes();
});

describe("cableAngleStore", () => {
  it("set / get / clear are per node+socket; clear touches only its target", () => {
    expect(cableAngleStore.get("n1", "out")).toBeNull();
    cableAngleStore.set("n1", "a", 45);
    cableAngleStore.set("n1", "b", 270);
    cableAngleStore.set("n2", "in", 180);
    cableAngleStore.set("n1", "a", 90); // overwrite
    expect(cableAngleStore.get("n1", "a")).toBe(90);
    expect(cableAngleStore.get("n1", "b")).toBe(270);
    expect(cableAngleStore.get("n2", "in")).toBe(180);
    cableAngleStore.clear("n1", "a");
    expect(cableAngleStore.get("n1", "a")).toBeNull();
    expect(cableAngleStore.get("n1", "b")).toBe(270);
  });

  it("notifies only on real changes: same-value set, absent-key clear and empty forget are silent", () => {
    cableAngleStore.set("n1", "out", 90);
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.set("n1", "out", 90); // unchanged — silent
    cableAngleStore.clear("n2", "out"); // nothing there — silent
    cableAngleStore.forget("n3"); // no angles — silent
    expect(cb).not.toHaveBeenCalled();
    cableAngleStore.set("n1", "out", 180); // real change
    cableAngleStore.clear("n1", "out"); // real removal
    expect(cb).toHaveBeenCalledTimes(2);
    cableAngleStore.set("n1", "out", 45);
    cableAngleStore.forget("n1"); // real forget notifies too
    expect(cb).toHaveBeenCalledTimes(4);
  });
});
