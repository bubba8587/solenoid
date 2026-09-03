import { describe, it, expect, beforeEach } from "vitest";
import { socketFlipStore } from "../../src/graph/socketFlipStore";
import { isFlippableNode, registerFlippable } from "../../src/graph/flippableNodes";
import { forgetNode, forgetAllNodes } from "../../src/graph/nodeStoreRegistry";

describe("socketFlipStore", () => {
  beforeEach(() => socketFlipStore.clear());

  it("toggles a node's flipped flag", () => {
    expect(socketFlipStore.get("n1")).toBe(false);
    socketFlipStore.toggle("n1");
    expect(socketFlipStore.get("n1")).toBe(true);
    socketFlipStore.toggle("n1");
    expect(socketFlipStore.get("n1")).toBe(false);
  });

  it("set is idempotent and independent per node", () => {
    socketFlipStore.set("a", true);
    socketFlipStore.set("a", true);
    expect(socketFlipStore.get("a")).toBe(true);
    expect(socketFlipStore.get("b")).toBe(false);
  });

  it("notifies subscribers on change", () => {
    let ticks = 0;
    const off = socketFlipStore.subscribe(() => { ticks++; });
    socketFlipStore.toggle("x");
    expect(ticks).toBeGreaterThan(0);
    off();
  });

  it("forgets a single node via the node-store registry", () => {
    socketFlipStore.set("gone", true);
    forgetNode("gone");
    expect(socketFlipStore.get("gone")).toBe(false);
  });

  it("clears all on a bulk forget (rebuild)", () => {
    socketFlipStore.set("a", true);
    socketFlipStore.set("b", true);
    forgetAllNodes();
    expect(socketFlipStore.get("a")).toBe(false);
    expect(socketFlipStore.get("b")).toBe(false);
  });
});

describe("isFlippableNode", () => {
  const fake = (name: string) => ({ constructor: { name } });

  it("recognizes the registered Display node", () => {
    expect(isFlippableNode(fake("DisplayNode"))).toBe(true);
  });

  it("rejects a node type that hasn't opted in", () => {
    expect(isFlippableNode(fake("ArithmeticNode"))).toBe(false);
    expect(isFlippableNode(null)).toBe(false);
  });

  it("lets a new type opt in", () => {
    expect(isFlippableNode(fake("WidgetNode"))).toBe(false);
    registerFlippable("WidgetNode");
    expect(isFlippableNode(fake("WidgetNode"))).toBe(true);
  });
});
