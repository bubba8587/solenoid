// [[A1]] visualGraphCalculator (the snapshot history)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SavedGraph } from "../../../src/graph/persistence";

const h = vi.hoisted(() => ({
  doc: null as unknown,
  rebuilding: 0,
  view: null as unknown,
  loads: [] as Array<{ doc: unknown; gated: boolean }>,
  onLoad: null as null | (() => void),
}));

vi.mock("../../../src/graph/persistence", () => ({
  serializeGraph: () => (h.doc ? structuredClone(h.doc) : null),
  loadGraph: async (g: unknown) => {
    h.loads.push({ doc: g, gated: h.rebuilding > 0 });
    h.doc = g;
    h.onLoad?.();
    return true;
  },
  scheduleAutosave: () => {},
}));

vi.mock("../../../src/graph/process", () => ({
  getView: () => h.view,
  isGraphRebuilding: () => h.rebuilding > 0,
  withGraphRebuild: async <T>(fn: () => Promise<T>): Promise<T> => {
    h.rebuilding++;
    try { return await fn(); } finally { h.rebuilding--; }
  },
}));

import { flowHistory } from "../../../src/graph/flow/flowHistory";

const doc = (name: string, value: unknown = 1): SavedGraph =>
  ({ v: 2, nodes: [{ id: name, type: "NumberInputNode", name, x: 0, y: 0, init: { value } }], connections: [] }) as SavedGraph;

beforeEach(() => {
  vi.useFakeTimers();
  h.doc = null;
  h.rebuilding = 0;
  h.view = null;
  h.loads = [];
  h.onLoad = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("undo and redo flush a pending edit", () => {
  it("an undo within the coalesce window keeps the pending edit and steps back one entry", async () => {
    h.doc = doc("a", 1);
    flowHistory.reset();
    h.doc = doc("a", 2);
    flowHistory.recordNow();
    h.doc = doc("a", 3);
    flowHistory.schedule();

    await flowHistory.undo();

    expect(h.loads).toHaveLength(1);
    expect(h.loads[0].gated).toBe(true);
    expect((h.loads[0].doc as SavedGraph).nodes[0].init).toEqual({ value: 2 });
    expect(flowHistory.canRedo()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(flowHistory._state()).toEqual({ depth: 3, index: 1 });
    await flowHistory.redo();
    expect((h.doc as SavedGraph).nodes[0].init).toEqual({ value: 3 });
  });

  it("a redo within the coalesce window records the pending edit, which drops the redo tail", async () => {
    h.doc = doc("a", 1);
    flowHistory.reset();
    h.doc = doc("a", 2);
    flowHistory.recordNow();
    await flowHistory.undo();
    h.doc = doc("a", 5);
    flowHistory.schedule();

    await flowHistory.redo();

    expect(h.loads).toHaveLength(1);
    expect(flowHistory._state()).toEqual({ depth: 2, index: 1 });
    expect((h.doc as SavedGraph).nodes[0].init).toEqual({ value: 5 });
  });
});

describe("the byte budget", () => {
  const big = (n: number) => doc("a", String(n).repeat(4_500_000));

  it("keeps the entry before the current one, so an edit to a large document stays undoable", () => {
    h.doc = big(1);
    flowHistory.reset();
    for (const n of [2, 3, 4]) {
      h.doc = big(n);
      flowHistory.recordNow();
      expect(flowHistory.canUndo()).toBe(true);
    }
    expect(flowHistory._state()).toEqual({ depth: 2, index: 1 });
  });

  it("lists every surviving action once the baseline is trimmed away", () => {
    h.doc = big(1);
    flowHistory.reset();
    expect(flowHistory.records()).toEqual([]);
    h.doc = big(2);
    flowHistory.recordNow();
    h.doc = big(3);
    flowHistory.recordNow();
    expect(flowHistory.records()).toHaveLength(2);
  });
});

describe("the camera across a restore", () => {
  it("comes back exactly, even between zoom steps where a pinch left it", async () => {
    vi.stubGlobal("document", { createElement: () => ({}) });
    const { makeFlowView } = await import("../../../src/graph/flow/flowView");
    const view = makeFlowView({ getNode: () => undefined } as never, {
      bumpNode() {}, bumpConnections() {}, moveNode() {}, setViewport() {}, getContainer: () => null,
    });
    h.view = view;
    view.setTransform({ x: 13, y: -41, k: 1.37 });
    h.onLoad = () => view.setTransform({ x: 0, y: 0, k: 0.6 });
    h.doc = doc("a", 1);
    flowHistory.reset();
    h.doc = doc("a", 2);
    flowHistory.recordNow();

    await flowHistory.undo();

    expect({ ...view.transform }).toEqual({ x: 13, y: -41, k: 1.37 });
  });
});
