import { beforeEach, describe, expect, it, vi } from "vitest";
import { collapseStore } from "./collapseStore";
import { forgetAllNodes } from "./nodeStoreRegistry";

// Node-scoped forget and cross-store cleanup live in nodeStoreRegistry.test.ts,
// which drives this store for real.
beforeEach(() => {
  forgetAllNodes();
  collapseStore.clear();
});

describe("collapseStore", () => {
  it("set / toggle track per-node collapse; nodes are independent", () => {
    expect(collapseStore.get("n1")).toBe(false);
    collapseStore.set("n1", true);
    collapseStore.set("n2", false);
    expect(collapseStore.get("n1")).toBe(true);
    expect(collapseStore.get("n2")).toBe(false);
    collapseStore.toggle("n1"); // expand
    collapseStore.toggle("n2"); // collapse
    expect(collapseStore.get("n1")).toBe(false);
    expect(collapseStore.get("n2")).toBe(true);
  });

  it("notifies only on real changes: same-value set, empty clear and untouched forget are silent", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.set("n1", false); // already expanded — silent
    collapseStore.clear(); // already empty — silent
    collapseStore.forget("n1"); // not collapsed — silent
    expect(cb).not.toHaveBeenCalled();
    collapseStore.set("n1", true);
    collapseStore.set("n1", true); // unchanged — silent
    collapseStore.toggle("n1"); // toggle always changes state
    expect(cb).toHaveBeenCalledTimes(2);
    collapseStore.set("n1", true);
    collapseStore.clear(); // one collapsed node existed — notifies and resets
    expect(collapseStore.get("n1")).toBe(false);
    expect(cb).toHaveBeenCalledTimes(4);
  });
});
