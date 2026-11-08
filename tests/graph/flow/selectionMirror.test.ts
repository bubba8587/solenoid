// [[C120]] linearWork, [[react-flow-surface-contract#Selection]]
import { describe, expect, it } from "vitest";
import { mirrorSelection, type SelectionState } from "../../../src/graph/flow/selectionMirror";

function fakeStore(initial: SelectionState) {
  let state = initial;
  const listeners = new Set<(s: SelectionState) => void>();
  return {
    getState: () => state,
    subscribe: (fn: (s: SelectionState) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    set(patch: Partial<SelectionState>) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); },
  };
}

const lookup = (sel: Record<string, boolean>) => new Map(Object.entries(sel).map(([id, selected]) => [id, { selected }]));

describe("selection mirror", () => {
  it("reports the selection at once and again on each change", () => {
    const store = fakeStore({ nodes: [], edges: [], nodeLookup: lookup({ a: true, b: false }), edgeLookup: lookup({ e1: false }) });
    const calls: Array<[string[], string[]]> = [];
    mirrorSelection(store, (n, e) => calls.push([n, e]));
    expect(calls).toEqual([[["a"], []]]);
    store.set({ edges: [], edgeLookup: lookup({ e1: true }) });
    expect(calls).toEqual([[["a"], []], [["a"], ["e1"]]]);
  });

  it("never scans on an update that keeps the nodes and edges arrays, as a camera move does", () => {
    const nodes: unknown[] = [];
    const edges: unknown[] = [];
    let scans = 0;
    const nodeLookup = lookup({ a: true });
    const counted = new Proxy(nodeLookup, {
      get(target, prop) {
        if (prop === Symbol.iterator) scans++;
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const store = fakeStore({ nodes, edges, nodeLookup: counted, edgeLookup: lookup({}) });
    let calls = 0;
    mirrorSelection(store, () => calls++);
    expect(scans).toBe(1);
    for (let i = 0; i < 50; i++) store.set({});
    expect(scans).toBe(1);
    expect(calls).toBe(1);
  });

  it("stays quiet when new arrays carry the same selection", () => {
    const store = fakeStore({ nodes: [], edges: [], nodeLookup: lookup({ a: true }), edgeLookup: lookup({}) });
    let calls = 0;
    mirrorSelection(store, () => calls++);
    store.set({ nodes: [] });
    expect(calls).toBe(1);
  });

  it("stops after unsubscribing", () => {
    const store = fakeStore({ nodes: [], edges: [], nodeLookup: lookup({}), edgeLookup: lookup({}) });
    let calls = 0;
    const off = mirrorSelection(store, () => calls++);
    off();
    store.set({ nodes: [], nodeLookup: lookup({ a: true }) });
    expect(calls).toBe(1);
  });
});
