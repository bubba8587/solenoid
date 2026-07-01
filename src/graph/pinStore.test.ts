import { beforeEach, describe, expect, it, vi } from "vitest";
import { pinStore } from "./pinStore";

beforeEach(() => {
  pinStore.clear();
});

describe("pinStore — list / has", () => {
  it("list is empty initially", () => {
    expect(pinStore.list()).toHaveLength(0);
  });

  it("has returns false for an unpinned node", () => {
    expect(pinStore.has("n1")).toBe(false);
  });

  it("has returns true after toggle (pin)", () => {
    pinStore.toggle("n1", "out");
    expect(pinStore.has("n1")).toBe(true);
  });

  it("list includes the pin after toggle", () => {
    pinStore.toggle("n1", "out");
    const pins = pinStore.list();
    expect(pins).toHaveLength(1);
    expect(pins[0]).toEqual({ nodeId: "n1", outputKey: "out" });
  });

  it("list returns the internal array directly (not a copy)", () => {
    // Characterization: list() is a direct reference; external push mutates the store.
    // Tests that observe this should use serialize() for a safe snapshot instead.
    pinStore.toggle("n1", "out");
    const pins = pinStore.list() as { nodeId: string; outputKey: string }[];
    pins.push({ nodeId: "n2", outputKey: "out" });
    expect(pinStore.list()).toHaveLength(2);
  });

  it("tracks multiple independent pins", () => {
    pinStore.toggle("n1", "result");
    pinStore.toggle("n2", "value");
    expect(pinStore.list()).toHaveLength(2);
    expect(pinStore.has("n1")).toBe(true);
    expect(pinStore.has("n2")).toBe(true);
  });
});

describe("pinStore — toggle", () => {
  it("pins a node not yet pinned", () => {
    pinStore.toggle("n1", "out");
    expect(pinStore.has("n1")).toBe(true);
  });

  it("unpins a node that is already pinned", () => {
    pinStore.toggle("n1", "out");
    pinStore.toggle("n1", "out");
    expect(pinStore.has("n1")).toBe(false);
    expect(pinStore.list()).toHaveLength(0);
  });

  it("always notifies (pin case)", () => {
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.toggle("n1", "out");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("always notifies (unpin case)", () => {
    pinStore.toggle("n1", "out");
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.toggle("n1", "out");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("toggling one node does not affect another", () => {
    pinStore.toggle("n1", "out");
    pinStore.toggle("n2", "value");
    pinStore.toggle("n1", "out"); // unpin n1
    expect(pinStore.has("n1")).toBe(false);
    expect(pinStore.has("n2")).toBe(true);
  });

  it("stores the outputKey provided at pin time", () => {
    pinStore.toggle("n1", "result");
    const pin = pinStore.list().find((p) => p.nodeId === "n1");
    expect(pin?.outputKey).toBe("result");
  });
});

describe("pinStore — remove", () => {
  it("removes a pinned node", () => {
    pinStore.toggle("n1", "out");
    pinStore.remove("n1");
    expect(pinStore.has("n1")).toBe(false);
  });

  it("notifies when a pin was removed", () => {
    pinStore.toggle("n1", "out");
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.remove("n1");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("no-ops and does not notify when node is not pinned", () => {
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.remove("n1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("only removes the targeted node, not others", () => {
    pinStore.toggle("n1", "out");
    pinStore.toggle("n2", "value");
    pinStore.remove("n1");
    expect(pinStore.has("n1")).toBe(false);
    expect(pinStore.has("n2")).toBe(true);
  });
});

describe("pinStore — clear", () => {
  it("removes all pins", () => {
    pinStore.toggle("n1", "a");
    pinStore.toggle("n2", "b");
    pinStore.clear();
    expect(pinStore.list()).toHaveLength(0);
  });

  it("notifies when there were pins to clear", () => {
    pinStore.toggle("n1", "out");
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.clear();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does not notify when already empty", () => {
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.clear();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("pinStore — serialize / load", () => {
  it("serialize returns plain copies matching the current pins", () => {
    pinStore.toggle("n1", "out");
    pinStore.toggle("n2", "value");
    const s = pinStore.serialize();
    expect(s).toEqual([
      { nodeId: "n1", outputKey: "out" },
      { nodeId: "n2", outputKey: "value" },
    ]);
  });

  it("serialize returns plain copies — mutation does not affect the store", () => {
    pinStore.toggle("n1", "out");
    const s = pinStore.serialize();
    s.push({ nodeId: "n99", outputKey: "x" });
    expect(pinStore.list()).toHaveLength(1);
  });

  it("load replaces the current pin set", () => {
    pinStore.toggle("n1", "out");
    pinStore.load([{ nodeId: "n2", outputKey: "value" }]);
    expect(pinStore.has("n1")).toBe(false);
    expect(pinStore.has("n2")).toBe(true);
    expect(pinStore.list()).toHaveLength(1);
  });

  it("load always notifies", () => {
    const cb = vi.fn();
    pinStore.subscribe(cb);
    pinStore.load([]);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("load stores plain copies — external mutation does not affect the store", () => {
    const incoming = [{ nodeId: "n1", outputKey: "out" }];
    pinStore.load(incoming);
    incoming[0].outputKey = "mutated";
    expect(pinStore.list()[0].outputKey).toBe("out");
  });

  it("serialize after load round-trips correctly", () => {
    const original = [
      { nodeId: "n1", outputKey: "result" },
      { nodeId: "n2", outputKey: "" },
    ];
    pinStore.load(original);
    expect(pinStore.serialize()).toEqual(original);
  });
});

describe("pinStore — node forget (noderemoved cleanup)", () => {
  it("remove clears a pin when its node is deleted", () => {
    pinStore.toggle("n1", "out");
    pinStore.remove("n1");
    expect(pinStore.has("n1")).toBe(false);
  });

  it("remove does not affect other pins", () => {
    pinStore.toggle("n1", "out");
    pinStore.toggle("n2", "value");
    pinStore.remove("n1");
    expect(pinStore.has("n2")).toBe(true);
  });
});
