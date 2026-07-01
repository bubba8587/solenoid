import { describe, it, expect } from "vitest";
import { getGuardedSocketPosition } from "./guardedSocketPosition";

// The watcher's storage is keyed by DOM element, but the test only needs object
// identity (the guard never touches the elements as DOM nodes), so plain objects
// standing in for elements are enough.
type Rec = { element: object; side: "input" | "output"; key: string; nodeId: string; position: { x: number; y: number } };

function storageOf(w: unknown) {
  return (w as { sockets: { elements: Map<object, Rec[]>; add(r: Rec): void } }).sockets;
}

describe("getGuardedSocketPosition", () => {
  it("keeps exactly one element per (node, key, side), evicting the prior one", () => {
    const storage = storageOf(getGuardedSocketPosition());
    const elA = {}, elB = {};
    const rec = (element: object): Rec => ({ element, side: "output", key: "out", nodeId: "n1", position: { x: 0, y: 0 } });

    storage.add(rec(elA));
    expect([...storage.elements.keys()]).toEqual([elA]);

    // A re-render into a NEW element for the SAME socket must drop the old one
    // (rete's default would keep both → the "more than one element" warning).
    storage.add(rec(elB));
    expect([...storage.elements.keys()]).toEqual([elB]);
  });

  it("leaves a different socket on the same element untouched", () => {
    const storage = storageOf(getGuardedSocketPosition());
    const el = {};
    storage.add({ element: el, side: "input", key: "a", nodeId: "n1", position: { x: 0, y: 0 } });
    storage.add({ element: el, side: "input", key: "b", nodeId: "n1", position: { x: 0, y: 0 } });
    // Same element, two distinct sockets — both records coexist under that key.
    expect(storage.elements.get(el)?.map((r) => r.key).sort()).toEqual(["a", "b"]);
  });

  it("does not evict a same-key socket on a different node", () => {
    const storage = storageOf(getGuardedSocketPosition());
    const elA = {}, elB = {};
    storage.add({ element: elA, side: "output", key: "out", nodeId: "n1", position: { x: 0, y: 0 } });
    storage.add({ element: elB, side: "output", key: "out", nodeId: "n2", position: { x: 0, y: 0 } });
    expect(storage.elements.size).toBe(2);
  });
});
