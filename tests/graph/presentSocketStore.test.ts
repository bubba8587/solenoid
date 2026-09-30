// [[B10]] reactFlowView
import { describe, it, expect, beforeEach } from "vitest";
import { presentSocketStore, presentSocketKeys } from "../../src/graph/presentSocketStore";
import { forgetAllNodes, forgetNode } from "../../src/graph/nodeStoreRegistry";

const settle = () => Promise.resolve();
const node = { id: "n1", inputs: { a: {}, b: {}, c: {} }, outputs: { out: {}, alt: {} } };

describe("presentSocketStore", () => {
  beforeEach(() => forgetAllNodes());

  it("knows nothing of a card that never rendered, so readers take every declared socket", () => {
    expect(presentSocketStore.get("n1")).toBeUndefined();
    expect(presentSocketKeys(node, "input")).toEqual(["a", "b", "c"]);
  });

  it("lists the mounted sockets in declared order, and drops one that unmounts while the card is drawn", async () => {
    const offs = [presentSocketStore.mount("n1", "input", "c"), presentSocketStore.mount("n1", "input", "a"), presentSocketStore.mount("n1", "output", "out")];
    await settle();
    expect(presentSocketKeys(node, "input")).toEqual(["a", "c"]);
    expect(presentSocketKeys(node, "output")).toEqual(["out"]);
    offs[0]();
    await settle();
    expect(presentSocketKeys(node, "input")).toEqual(["a"]);
  });

  it("counts a socket drawn twice until both copies unmount", async () => {
    const a1 = presentSocketStore.mount("n1", "input", "a");
    const a2 = presentSocketStore.mount("n1", "input", "a");
    presentSocketStore.mount("n1", "output", "out");
    a1();
    await settle();
    expect(presentSocketKeys(node, "input")).toEqual(["a"]);
    a2();
    await settle();
    expect(presentSocketKeys(node, "input")).toEqual([]);
  });

  it("swaps a mode's sockets within one commit", async () => {
    const off = presentSocketStore.mount("n1", "input", "a");
    await settle();
    off();
    presentSocketStore.mount("n1", "input", "b");
    await settle();
    expect(presentSocketKeys(node, "input")).toEqual(["b"]);
  });

  it("keeps the last shown set when the whole card unmounts, as a collapsed group's member does", async () => {
    const offs = [presentSocketStore.mount("n1", "input", "b"), presentSocketStore.mount("n1", "output", "alt")];
    await settle();
    offs.forEach((f) => f());
    await settle();
    expect(presentSocketKeys(node, "input")).toEqual(["b"]);
    expect(presentSocketKeys(node, "output")).toEqual(["alt"]);
  });

  it("forgets a deleted node, and everything on a rebuild", async () => {
    presentSocketStore.mount("n1", "input", "a");
    presentSocketStore.mount("n2", "input", "a");
    await settle();
    forgetNode("n1");
    expect(presentSocketStore.get("n1")).toBeUndefined();
    expect(presentSocketStore.get("n2")).toBeDefined();
    forgetAllNodes();
    expect(presentSocketStore.get("n2")).toBeUndefined();
  });
});
