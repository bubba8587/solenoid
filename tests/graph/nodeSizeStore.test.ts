import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodeSizeStore } from "../../src/graph/nodeSizeStore";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";

// Node-scoped forget and cross-store cleanup live in nodeStoreRegistry.test.ts,
// which drives this store for real.
beforeEach(() => {
  forgetAllNodes();
  nodeSizeStore.clear();
});

describe("nodeSizeStore", () => {
  it("set / get track nodes independently; set(id, undefined) deletes", () => {
    expect(nodeSizeStore.get("n1")).toBeUndefined();
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n2", { w: 300, h: 200 });
    nodeSizeStore.set("n1", { w: 400, h: 300 }); // overwrite
    expect(nodeSizeStore.get("n1")).toEqual({ w: 400, h: 300 });
    expect(nodeSizeStore.get("n2")).toEqual({ w: 300, h: 200 });
    nodeSizeStore.set("n1", undefined);
    expect(nodeSizeStore.get("n1")).toBeUndefined();
  });

  it("set and delete-set notify; an empty forget or empty clear stays silent", () => {
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.forget("n1"); // no size — silent
    nodeSizeStore.clear(); // already empty — silent
    expect(cb).not.toHaveBeenCalled();
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n1", undefined);
    expect(cb).toHaveBeenCalledTimes(2);
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.clear(); // entries existed — notifies
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it("entries returns all pairs as a copy — mutations do not affect the store", () => {
    expect(nodeSizeStore.entries()).toEqual([]);
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n2", { w: 200, h: 160 });
    const e = nodeSizeStore.entries();
    expect(e).toHaveLength(2);
    expect(e).toContainEqual(["n1", { w: 100, h: 80 }]);
    expect(e).toContainEqual(["n2", { w: 200, h: 160 }]);
    e.push(["n99", { w: 999, h: 999 }]);
    expect(nodeSizeStore.entries()).toHaveLength(2);
  });
});
