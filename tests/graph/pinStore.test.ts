import { beforeEach, describe, expect, it, vi } from "vitest";
import { pinStore } from "../../src/graph/pinStore";

beforeEach(() => {
  pinStore.clear();
});

describe("pinStore — toggle / remove / clear", () => {
  it("toggle pins, toggles off, and notifies on both edges; nodes are independent", () => {
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.toggle("n1", "result");
    pinStore.toggle("n2", "value");
    expect(pinStore.has("n1")).toBe(true);
    expect(pinStore.list()).toHaveLength(2);
    pinStore.toggle("n1", "result"); // unpin n1 only
    expect(pinStore.has("n1")).toBe(false);
    expect(pinStore.has("n2")).toBe(true);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("list returns the internal array directly (not a copy)", () => {
    // Characterization: list() is a direct reference; external push mutates the store.
    // Tests that observe this should use serialize() for a safe snapshot instead.
    pinStore.toggle("n1", "out");
    const pins = pinStore.list() as { nodeId: string; outputKey: string }[];
    pins.push({ nodeId: "n2", outputKey: "out" });
    expect(pinStore.list()).toHaveLength(2);
  });

  it("remove drops only the targeted node's pin, and notifies", () => {
    pinStore.toggle("n1", "out");
    pinStore.toggle("n2", "value");
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.remove("n1");
    expect(pinStore.has("n1")).toBe(false);
    expect(pinStore.has("n2")).toBe(true);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("remove no-ops and does not notify when the node is not pinned", () => {
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.remove("n1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("clear removes all pins and notifies — but not when already empty", () => {
    pinStore.toggle("n1", "a");
    pinStore.toggle("n2", "b");
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.clear();
    expect(pinStore.list()).toHaveLength(0);
    expect(cb).toHaveBeenCalledOnce();
    pinStore.clear(); // already empty — no second notify
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("pinStore — serialize / load", () => {
  it("round-trips through plain copies: mutating either side never reaches the store", () => {
    const incoming = [
      { nodeId: "n1", outputKey: "result" },
      { nodeId: "n2", outputKey: "" },
    ];
    pinStore.load(incoming);
    incoming[0].outputKey = "mutated";
    expect(pinStore.serialize()).toEqual([
      { nodeId: "n1", outputKey: "result" },
      { nodeId: "n2", outputKey: "" },
    ]);
    const s = pinStore.serialize();
    s.push({ nodeId: "n99", outputKey: "x" });
    expect(pinStore.list()).toHaveLength(2);
  });

  it("load REPLACES the current pin set and notifies", () => {
    pinStore.toggle("n1", "out");
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.load([{ nodeId: "n2", outputKey: "value" }]);
    expect(pinStore.has("n1")).toBe(false);
    expect(pinStore.has("n2")).toBe(true);
    expect(pinStore.list()).toHaveLength(1);
    expect(cb).toHaveBeenCalledOnce();
  });
});
