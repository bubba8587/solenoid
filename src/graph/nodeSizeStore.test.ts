import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodeSizeStore } from "./nodeSizeStore";
import { forgetAllNodes } from "./nodeStoreRegistry";

beforeEach(() => {
  forgetAllNodes();
  nodeSizeStore.clear();
  nodeSizeStore.setDragging(false);
});

describe("nodeSizeStore — get", () => {
  it("returns undefined for a node that was never sized", () => {
    expect(nodeSizeStore.get("n1")).toBeUndefined();
  });

  it("returns the stored size after set", () => {
    nodeSizeStore.set("n1", { w: 200, h: 150 });
    expect(nodeSizeStore.get("n1")).toEqual({ w: 200, h: 150 });
  });

  it("tracks multiple nodes independently", () => {
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n2", { w: 300, h: 200 });
    expect(nodeSizeStore.get("n1")).toEqual({ w: 100, h: 80 });
    expect(nodeSizeStore.get("n2")).toEqual({ w: 300, h: 200 });
  });

  it("returns undefined after set(id, undefined) deletes the entry", () => {
    nodeSizeStore.set("n1", { w: 200, h: 150 });
    nodeSizeStore.set("n1", undefined);
    expect(nodeSizeStore.get("n1")).toBeUndefined();
  });
});

describe("nodeSizeStore — set", () => {
  it("notifies on a new entry", () => {
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("notifies even when setting the same value again (no equality guard)", () => {
    // Characterization: set() always notifies regardless of whether the value changed.
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("notifies when set(id, undefined) deletes an existing entry", () => {
    nodeSizeStore.set("n1", { w: 200, h: 150 });
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.set("n1", undefined);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("notifies when set(id, undefined) called for absent node (no guard)", () => {
    // Characterization: set(id, undefined) on an absent key still calls notify().
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.set("n1", undefined);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("overwrites the stored size on a second set", () => {
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n1", { w: 400, h: 300 });
    expect(nodeSizeStore.get("n1")).toEqual({ w: 400, h: 300 });
  });
});

describe("nodeSizeStore — forget", () => {
  it("removes a sized node's entry", () => {
    nodeSizeStore.set("n1", { w: 200, h: 150 });
    nodeSizeStore.forget("n1");
    expect(nodeSizeStore.get("n1")).toBeUndefined();
  });

  it("notifies when a sized node is forgotten", () => {
    nodeSizeStore.set("n1", { w: 200, h: 150 });
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.forget("n1");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("no-ops and does not notify when node has no size", () => {
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.forget("n1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("only removes the targeted node, not others", () => {
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n2", { w: 200, h: 160 });
    nodeSizeStore.forget("n1");
    expect(nodeSizeStore.get("n1")).toBeUndefined();
    expect(nodeSizeStore.get("n2")).toEqual({ w: 200, h: 160 });
  });
});

describe("nodeSizeStore — clear", () => {
  it("removes all entries", () => {
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n2", { w: 200, h: 160 });
    nodeSizeStore.clear();
    expect(nodeSizeStore.get("n1")).toBeUndefined();
    expect(nodeSizeStore.get("n2")).toBeUndefined();
  });

  it("notifies when entries existed", () => {
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.clear();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does not notify when already empty", () => {
    const cb = vi.fn();
    nodeSizeStore.subscribe(cb);
    nodeSizeStore.clear();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("nodeSizeStore — entries", () => {
  it("returns empty array when no sizes set", () => {
    expect(nodeSizeStore.entries()).toEqual([]);
  });

  it("returns all [id, size] pairs", () => {
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    nodeSizeStore.set("n2", { w: 200, h: 160 });
    const e = nodeSizeStore.entries();
    expect(e).toHaveLength(2);
    expect(e).toContainEqual(["n1", { w: 100, h: 80 }]);
    expect(e).toContainEqual(["n2", { w: 200, h: 160 }]);
  });

  it("returns a copy — mutations do not affect the store", () => {
    nodeSizeStore.set("n1", { w: 100, h: 80 });
    const e = nodeSizeStore.entries();
    e.push(["n99", { w: 999, h: 999 }]);
    expect(nodeSizeStore.entries()).toHaveLength(1);
  });
});

describe("nodeSizeStore — dragging flag", () => {
  it("isDragging is false by default", () => {
    expect(nodeSizeStore.isDragging()).toBe(false);
  });

  it("setDragging(true) is reflected by isDragging", () => {
    nodeSizeStore.setDragging(true);
    expect(nodeSizeStore.isDragging()).toBe(true);
  });

  it("setDragging(false) clears the flag", () => {
    nodeSizeStore.setDragging(true);
    nodeSizeStore.setDragging(false);
    expect(nodeSizeStore.isDragging()).toBe(false);
  });
});
