import { beforeEach, describe, expect, it, vi } from "vitest";
import { cableValueStore } from "./cableValueStore";
import { forgetAllNodes } from "./nodeStoreRegistry";

// Reset all node-keyed stores between tests (cableValueStore registers itself).
beforeEach(() => {
  forgetAllNodes();
});

describe("cableValueStore — set / get", () => {
  it("get returns undefined for a key that was never set", () => {
    expect(cableValueStore.get("n1", "out")).toBeUndefined();
  });

  it("setNodeOutputs stores each output under nodeId:key", () => {
    cableValueStore.setNodeOutputs("n1", { result: 42 });
    expect(cableValueStore.get("n1", "result")).toBe(42);
  });

  it("stores multiple outputs from one call", () => {
    cableValueStore.setNodeOutputs("n1", { a: 1, b: 2, c: "hello" });
    expect(cableValueStore.get("n1", "a")).toBe(1);
    expect(cableValueStore.get("n1", "b")).toBe(2);
    expect(cableValueStore.get("n1", "c")).toBe("hello");
  });

  it("stores values for multiple independent nodes", () => {
    cableValueStore.setNodeOutputs("n1", { out: 10 });
    cableValueStore.setNodeOutputs("n2", { out: 20 });
    expect(cableValueStore.get("n1", "out")).toBe(10);
    expect(cableValueStore.get("n2", "out")).toBe(20);
  });

  it("overwrites an existing value on a second call", () => {
    cableValueStore.setNodeOutputs("n1", { out: 1 });
    cableValueStore.setNodeOutputs("n1", { out: 99 });
    expect(cableValueStore.get("n1", "out")).toBe(99);
  });

  it("stores any value type (array, object, null, boolean)", () => {
    cableValueStore.setNodeOutputs("n1", {
      arr: [1, 2, 3],
      obj: { x: 0 },
      nil: null,
      flag: false,
    });
    expect(cableValueStore.get("n1", "arr")).toEqual([1, 2, 3]);
    expect(cableValueStore.get("n1", "obj")).toEqual({ x: 0 });
    expect(cableValueStore.get("n1", "nil")).toBeNull();
    expect(cableValueStore.get("n1", "flag")).toBe(false);
  });

  it("get returns undefined for a key on a known node that was never set for that key", () => {
    cableValueStore.setNodeOutputs("n1", { out: 5 });
    expect(cableValueStore.get("n1", "other")).toBeUndefined();
  });
});

describe("cableValueStore — forget", () => {
  it("forget removes all outputs for the given node", () => {
    cableValueStore.setNodeOutputs("n1", { a: 1, b: 2 });
    cableValueStore.forget("n1");
    expect(cableValueStore.get("n1", "a")).toBeUndefined();
    expect(cableValueStore.get("n1", "b")).toBeUndefined();
  });

  it("forget does not remove outputs for other nodes", () => {
    cableValueStore.setNodeOutputs("n1", { out: 1 });
    cableValueStore.setNodeOutputs("n2", { out: 2 });
    cableValueStore.forget("n1");
    expect(cableValueStore.get("n2", "out")).toBe(2);
  });

  it("forget does not match a node whose id is a prefix of another node's id", () => {
    // "n1" must not clobber "n10" (colon separator makes the prefix unambiguous)
    cableValueStore.setNodeOutputs("n1", { out: 1 });
    cableValueStore.setNodeOutputs("n10", { out: 10 });
    cableValueStore.forget("n1");
    expect(cableValueStore.get("n10", "out")).toBe(10);
  });

  it("forget on an unknown nodeId is a no-op", () => {
    cableValueStore.setNodeOutputs("n1", { out: 1 });
    cableValueStore.forget("nope");
    expect(cableValueStore.get("n1", "out")).toBe(1);
  });
});

describe("cableValueStore — bump / subscribe / version", () => {
  it("version increments on each bump", () => {
    const v0 = cableValueStore.version();
    cableValueStore.bump();
    expect(cableValueStore.version()).toBe(v0 + 1);
    cableValueStore.bump();
    expect(cableValueStore.version()).toBe(v0 + 2);
  });

  it("subscribe fires the listener on bump", () => {
    const fn = vi.fn();
    cableValueStore.subscribe(fn);
    cableValueStore.bump();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("subscribe returns an unsubscribe that stops future calls", () => {
    const fn = vi.fn();
    const unsub = cableValueStore.subscribe(fn);
    unsub();
    cableValueStore.bump();
    expect(fn).not.toHaveBeenCalled();
  });

  it("multiple listeners each fire on bump", () => {
    const a = vi.fn();
    const b = vi.fn();
    cableValueStore.subscribe(a);
    cableValueStore.subscribe(b);
    cableValueStore.bump();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("setNodeOutputs alone does NOT bump (version stays the same)", () => {
    const v0 = cableValueStore.version();
    cableValueStore.setNodeOutputs("n1", { out: 1 });
    expect(cableValueStore.version()).toBe(v0);
  });

  it("forget alone does NOT bump", () => {
    cableValueStore.setNodeOutputs("n1", { out: 1 });
    const v0 = cableValueStore.version();
    cableValueStore.forget("n1");
    expect(cableValueStore.version()).toBe(v0);
  });
});
