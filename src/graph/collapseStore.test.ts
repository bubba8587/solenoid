import { beforeEach, describe, expect, it, vi } from "vitest";
import { collapseStore } from "./collapseStore";
import { forgetAllNodes } from "./nodeStoreRegistry";

beforeEach(() => {
  forgetAllNodes();
  collapseStore.clear();
});

describe("collapseStore — get", () => {
  it("returns false for a node that was never touched", () => {
    expect(collapseStore.get("n1")).toBe(false);
  });

  it("returns true after set(true)", () => {
    collapseStore.set("n1", true);
    expect(collapseStore.get("n1")).toBe(true);
  });

  it("returns false after set(false)", () => {
    collapseStore.set("n1", true);
    collapseStore.set("n1", false);
    expect(collapseStore.get("n1")).toBe(false);
  });

  it("tracks multiple nodes independently", () => {
    collapseStore.set("n1", true);
    collapseStore.set("n2", false);
    expect(collapseStore.get("n1")).toBe(true);
    expect(collapseStore.get("n2")).toBe(false);
  });
});

describe("collapseStore — set no-op on same value", () => {
  it("does not notify when set(true) called while already collapsed", () => {
    collapseStore.set("n1", true);
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.set("n1", true);
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not notify when set(false) called while already expanded", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.set("n1", false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("notifies when set actually changes the state", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.set("n1", true);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe("collapseStore — toggle", () => {
  it("collapses an expanded node", () => {
    collapseStore.toggle("n1");
    expect(collapseStore.get("n1")).toBe(true);
  });

  it("expands a collapsed node", () => {
    collapseStore.set("n1", true);
    collapseStore.toggle("n1");
    expect(collapseStore.get("n1")).toBe(false);
  });

  it("always notifies on toggle (state always changes)", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.toggle("n1");
    collapseStore.toggle("n1");
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe("collapseStore — clear", () => {
  it("resets all nodes to expanded", () => {
    collapseStore.set("n1", true);
    collapseStore.set("n2", true);
    collapseStore.clear();
    expect(collapseStore.get("n1")).toBe(false);
    expect(collapseStore.get("n2")).toBe(false);
  });

  it("notifies when there was at least one collapsed node", () => {
    collapseStore.set("n1", true);
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.clear();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does not notify when already empty", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.clear();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("collapseStore — forget (node removed)", () => {
  it("clears a collapsed node's entry", () => {
    collapseStore.set("n1", true);
    collapseStore.forget("n1");
    expect(collapseStore.get("n1")).toBe(false);
  });

  it("notifies when the node was collapsed", () => {
    collapseStore.set("n1", true);
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.forget("n1");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does not notify when the node was not collapsed", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.forget("n1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("only removes the targeted node, not others", () => {
    collapseStore.set("n1", true);
    collapseStore.set("n2", true);
    collapseStore.forget("n1");
    expect(collapseStore.get("n1")).toBe(false);
    expect(collapseStore.get("n2")).toBe(true);
  });
});

describe("collapseStore — subscribe", () => {
  it("fires on set(true)", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.set("n1", true);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("fires on toggle", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.toggle("n1");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("fires once per distinct change", () => {
    const cb = vi.fn();
    collapseStore.subscribe(cb);
    collapseStore.set("n1", true);
    collapseStore.set("n2", true);
    collapseStore.toggle("n1");
    expect(cb).toHaveBeenCalledTimes(3);
  });
});
