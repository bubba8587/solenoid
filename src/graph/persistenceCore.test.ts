import { describe, it, expect } from "vitest";
import {
  validateSavedGraph,
  chooseWriteSlot,
  chooseReadSlot,
  CURRENT_SAVE_VERSION,
  deriveMissingNodeSockets,
} from "./persistenceCore";

// A minimal but representative valid graph (a connection, a standoff, optional
// fields present) — the baseline that every "reject the broken variant" case
// mutates one field of.
const goodGraph = {
  v: 2,
  nodes: [
    { id: "n1", type: "ArithmeticNode", x: 10, y: 20, init: { op: "add" } },
    { id: "n2", type: "ConstantNode", x: 0, y: 0, init: {}, literals: { value: 3 } },
  ],
  connections: [
    { source: "n2", sourceOutput: "value", target: "n1", targetInput: "a" },
  ],
  standoffs: [
    { a: { nodeId: "n1", anchor: "e" }, b: { nodeId: "n2", anchor: "w" }, min: 16, max: 200 },
  ],
};

describe("validateSavedGraph", () => {
  it("accepts a well-formed graph", () => {
    expect(validateSavedGraph(goodGraph)).toEqual({ ok: true });
  });

  it("accepts an empty-but-valid graph", () => {
    expect(validateSavedGraph({ v: 2, nodes: [], connections: [] })).toEqual({ ok: true });
  });

  it("accepts a graph with no optional fields (version + nodes)", () => {
    expect(validateSavedGraph({ v: 2, nodes: [{ id: "a", type: "X" }] })).toEqual({ ok: true });
  });

  it("rejects a missing version", () => {
    const r = validateSavedGraph({ nodes: [], connections: [] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/format version/);
  });

  it.each([
    ["null", null],
    ["a string", "not a graph"],
    ["a number", 42],
    ["an array", []],
  ])("rejects %s", (_label, value) => {
    const r = validateSavedGraph(value);
    expect(r.ok).toBe(false);
  });

  it("rejects a missing nodes array", () => {
    const r = validateSavedGraph({ v: 2, connections: [] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/nodes/);
  });

  it("rejects a node without an id", () => {
    const r = validateSavedGraph({ v: 2, nodes: [{ type: "X", x: 0, y: 0 }] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/id/);
  });

  it("rejects a node without a type", () => {
    const r = validateSavedGraph({ v: 2, nodes: [{ id: "a", x: 0, y: 0 }] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/type/);
  });

  it("rejects a non-numeric coordinate", () => {
    const r = validateSavedGraph({ v: 2, nodes: [{ id: "a", type: "X", x: "10", y: 0 }] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/x/);
  });

  it("rejects a connection with a non-string endpoint", () => {
    const r = validateSavedGraph({
      v: 2,
      nodes: [{ id: "a", type: "X" }],
      connections: [{ source: "a", sourceOutput: "o", target: 5, targetInput: "i" }],
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/connection/);
  });

  it("rejects a non-array connections field", () => {
    const r = validateSavedGraph({ v: 2, nodes: [], connections: {} });
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a non-numeric version", () => {
    const r = validateSavedGraph({ v: "2", nodes: [] });
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects a non-array standoffs field", () => {
    const r = validateSavedGraph({ v: 2, nodes: [], standoffs: "none" });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("autosave slot rotation", () => {
  it("fills empty slots first (a before b)", () => {
    expect(chooseWriteSlot(null, null)).toBe("a");
    expect(chooseWriteSlot(5, null)).toBe("b");
    expect(chooseWriteSlot(null, 5)).toBe("a");
  });

  it("writes to the older slot so the newer copy is never at risk", () => {
    expect(chooseWriteSlot(10, 20)).toBe("a"); // a is older
    expect(chooseWriteSlot(20, 10)).toBe("b"); // b is older
    expect(chooseWriteSlot(7, 7)).toBe("a"); // tie → deterministic 'a'
  });

  it("reads the newer slot", () => {
    expect(chooseReadSlot(null, null)).toBeNull();
    expect(chooseReadSlot(10, null)).toBe("a");
    expect(chooseReadSlot(null, 10)).toBe("b");
    expect(chooseReadSlot(10, 20)).toBe("b");
    expect(chooseReadSlot(20, 10)).toBe("a");
  });

  it("round-trips: a sequence of writes always reads back the latest", () => {
    // Simulate the real loop — write picks the older slot, each write stamps a
    // strictly increasing seq — and assert the reader always lands on it.
    const slots: { a: number | null; b: number | null } = { a: null, b: null };
    let clock = 100;
    for (let i = 0; i < 8; i++) {
      const w = chooseWriteSlot(slots.a, slots.b);
      slots[w] = ++clock;
      const r = chooseReadSlot(slots.a, slots.b);
      expect(r).toBe(w); // the slot we just wrote is the newest
      expect(slots[r!]).toBe(clock);
    }
  });
});

describe("CURRENT_SAVE_VERSION", () => {
  it("matches the format the serializer writes (v2)", () => {
    expect(CURRENT_SAVE_VERSION).toBe(2);
  });
});

describe("deriveMissingNodeSockets", () => {
  const conns = [
    { source: "a", sourceOutput: "result", target: "miss", targetInput: "x" },
    { source: "miss", sourceOutput: "out", target: "b", targetInput: "value" },
    { source: "c", sourceOutput: "result", target: "miss", targetInput: "y" },
  ];

  it("collects the input + output keys a missing node's cables reference", () => {
    const m = deriveMissingNodeSockets(new Set(["miss"]), conns);
    expect(m.get("miss")).toEqual({ inputs: ["x", "y"], outputs: ["out"] });
  });

  it("ignores connections that don't touch an unknown id", () => {
    const m = deriveMissingNodeSockets(new Set(["miss"]), [
      { source: "a", sourceOutput: "r", target: "b", targetInput: "v" },
    ]);
    expect(m.size).toBe(0);
  });

  it("de-duplicates repeated socket keys, first-seen order", () => {
    const m = deriveMissingNodeSockets(new Set(["miss"]), [
      { source: "miss", sourceOutput: "out", target: "b", targetInput: "v" },
      { source: "miss", sourceOutput: "out", target: "c", targetInput: "w" },
      { source: "miss", sourceOutput: "alt", target: "d", targetInput: "z" },
    ]);
    expect(m.get("miss")).toEqual({ inputs: [], outputs: ["out", "alt"] });
  });

  it("handles two missing nodes wired to each other", () => {
    const m = deriveMissingNodeSockets(new Set(["m1", "m2"]), [
      { source: "m1", sourceOutput: "o", target: "m2", targetInput: "i" },
    ]);
    expect(m.get("m1")).toEqual({ inputs: [], outputs: ["o"] });
    expect(m.get("m2")).toEqual({ inputs: ["i"], outputs: [] });
  });
});
