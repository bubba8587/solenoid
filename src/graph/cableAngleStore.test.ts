import { beforeEach, describe, expect, it, vi } from "vitest";
import { cableAngleStore } from "./cableAngleStore";
import { forgetAllNodes } from "./nodeStoreRegistry";

beforeEach(() => {
  forgetAllNodes();
});

describe("cableAngleStore — get", () => {
  it("returns null when no angle has been set", () => {
    expect(cableAngleStore.get("n1", "out")).toBeNull();
  });

  it("returns the stored angle after set", () => {
    cableAngleStore.set("n1", "out", 90);
    expect(cableAngleStore.get("n1", "out")).toBe(90);
  });

  it("stores angles for independent node/socket pairs", () => {
    cableAngleStore.set("n1", "out", 0);
    cableAngleStore.set("n2", "in", 180);
    expect(cableAngleStore.get("n1", "out")).toBe(0);
    expect(cableAngleStore.get("n2", "in")).toBe(180);
  });

  it("stores multiple sockets on the same node independently", () => {
    cableAngleStore.set("n1", "a", 45);
    cableAngleStore.set("n1", "b", 270);
    expect(cableAngleStore.get("n1", "a")).toBe(45);
    expect(cableAngleStore.get("n1", "b")).toBe(270);
  });
});

describe("cableAngleStore — set no-op on same value", () => {
  it("does not notify when the same angle is set again", () => {
    cableAngleStore.set("n1", "out", 90);
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.set("n1", "out", 90);
    expect(cb).not.toHaveBeenCalled();
  });

  it("does notify when the angle actually changes", () => {
    cableAngleStore.set("n1", "out", 90);
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.set("n1", "out", 180);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("overwrites the stored value when angle changes", () => {
    cableAngleStore.set("n1", "out", 90);
    cableAngleStore.set("n1", "out", 270);
    expect(cableAngleStore.get("n1", "out")).toBe(270);
  });
});

describe("cableAngleStore — clear", () => {
  it("removes a stored angle", () => {
    cableAngleStore.set("n1", "out", 90);
    cableAngleStore.clear("n1", "out");
    expect(cableAngleStore.get("n1", "out")).toBeNull();
  });

  it("no-ops and does not notify when the key is absent", () => {
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.clear("n1", "out");
    expect(cb).not.toHaveBeenCalled();
  });

  it("only clears the targeted socket, not others on the same node", () => {
    cableAngleStore.set("n1", "a", 0);
    cableAngleStore.set("n1", "b", 90);
    cableAngleStore.clear("n1", "a");
    expect(cableAngleStore.get("n1", "a")).toBeNull();
    expect(cableAngleStore.get("n1", "b")).toBe(90);
  });

  it("notifies when a present key is cleared", () => {
    cableAngleStore.set("n1", "out", 45);
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.clear("n1", "out");
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("cableAngleStore — forget", () => {
  it("removes all sockets for the given node", () => {
    cableAngleStore.set("n1", "a", 0);
    cableAngleStore.set("n1", "b", 90);
    cableAngleStore.forget("n1");
    expect(cableAngleStore.get("n1", "a")).toBeNull();
    expect(cableAngleStore.get("n1", "b")).toBeNull();
  });

  it("does not remove sockets belonging to other nodes", () => {
    cableAngleStore.set("n1", "out", 0);
    cableAngleStore.set("n2", "out", 90);
    cableAngleStore.forget("n1");
    expect(cableAngleStore.get("n2", "out")).toBe(90);
  });

  it(":: separator means forget('n1') does NOT clobber 'n10' angles", () => {
    cableAngleStore.set("n1", "out", 0);
    cableAngleStore.set("n10", "out", 90);
    cableAngleStore.forget("n1");
    // 'n10::out' must survive — 'n1::' prefix does not match 'n10::out'
    expect(cableAngleStore.get("n10", "out")).toBe(90);
    expect(cableAngleStore.get("n1", "out")).toBeNull();
  });

  it("notifies when at least one angle was removed", () => {
    cableAngleStore.set("n1", "out", 0);
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.forget("n1");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does not notify when the node had no angles", () => {
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.forget("n1");
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("cableAngleStore — subscribe", () => {
  it("fires the callback on set (new value)", () => {
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.set("n1", "out", 45);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("fires the callback on clear (when present)", () => {
    cableAngleStore.set("n1", "out", 45);
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.clear("n1", "out");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("fires once per change, not per subscriber registration", () => {
    const cb = vi.fn();
    cableAngleStore.subscribe(cb);
    cableAngleStore.set("n1", "a", 10);
    cableAngleStore.set("n1", "b", 20);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
