import { describe, it, expect } from "vitest";
import { ConduitNode, conduitGhostSpecs, conduitLaneOf } from "./conduit";

// rotateBy is what the Canvas `[` / `]` keys call. It must keep the angle on the
// 45° quantum and wrap into [0, 360) in both directions.
describe("ConduitNode.rotateBy", () => {
  it("steps by 45° per unit, CW (+) and CCW (-)", () => {
    const c = new ConduitNode({ angle: 0 });
    c.rotateBy(1);
    expect(c.angle).toBe(45);
    c.rotateBy(2);
    expect(c.angle).toBe(135);
    c.rotateBy(-1);
    expect(c.angle).toBe(90);
  });

  it("wraps past 360 and below 0", () => {
    const c = new ConduitNode({ angle: 315 });
    c.rotateBy(1);
    expect(c.angle).toBe(0); // 360 → 0
    c.rotateBy(-1);
    expect(c.angle).toBe(315); // 0 - 45 → 315
  });

  it("snaps an off-quantum starting angle to the grid", () => {
    const c = new ConduitNode({ angle: 20 }); // nearest 45-multiple is 0
    c.rotateBy(1);
    expect(c.angle).toBe(45);
  });
});

describe("conduitLaneOf", () => {
  it("parses a lane index from a socket key, else -1", () => {
    expect(conduitLaneOf("in_0", "in")).toBe(0);
    expect(conduitLaneOf("in_3", "in")).toBe(3);
    expect(conduitLaneOf("out_5", "out")).toBe(5);
    expect(conduitLaneOf("out_2", "in")).toBe(-1); // wrong side
    expect(conduitLaneOf("frame", "in")).toBe(-1); // not a lane key
    expect(conduitLaneOf(undefined, "in")).toBe(-1);
  });
});

// conduitGhostSpecs is the per-lane rewire on Conduit delete: each in_i pairs
// with out_i, ghosting the upstream source → downstream target.
describe("conduitGhostSpecs", () => {
  const conn = (source: string, sourceOutput: string, target: string, targetInput: string) =>
    ({ source, sourceOutput, target, targetInput });

  it("pairs in_i → out_i into upstream→downstream ghosts", () => {
    const incoming = [conn("A", "result", "cd", "in_0"), conn("B", "result", "cd", "in_1")];
    const outgoing = [conn("cd", "out_0", "C", "in"), conn("cd", "out_1", "D", "in")];
    expect(conduitGhostSpecs(incoming, outgoing, [])).toEqual([
      conn("A", "result", "C", "in"),
      conn("B", "result", "D", "in"),
    ]);
  });

  it("pairs by lane index, not array order", () => {
    const incoming = [conn("B", "result", "cd", "in_1"), conn("A", "result", "cd", "in_0")];
    const outgoing = [conn("cd", "out_1", "D", "in"), conn("cd", "out_0", "C", "in")];
    const specs = conduitGhostSpecs(incoming, outgoing, []);
    expect(specs).toHaveLength(2);
    expect(specs).toContainEqual(conn("A", "result", "C", "in"));
    expect(specs).toContainEqual(conn("B", "result", "D", "in"));
  });

  it("skips a lane missing an end", () => {
    const incoming = [conn("A", "result", "cd", "in_0"), conn("B", "result", "cd", "in_1")];
    const outgoing = [conn("cd", "out_0", "C", "in")]; // no out_1
    expect(conduitGhostSpecs(incoming, outgoing, [])).toEqual([conn("A", "result", "C", "in")]);
  });

  it("skips a self-loop (upstream === downstream node)", () => {
    const incoming = [conn("X", "result", "cd", "in_0")];
    const outgoing = [conn("cd", "out_0", "X", "in")];
    expect(conduitGhostSpecs(incoming, outgoing, [])).toEqual([]);
  });

  it("skips a wire that already exists", () => {
    const incoming = [conn("A", "result", "cd", "in_0")];
    const outgoing = [conn("cd", "out_0", "C", "in")];
    const existing = [conn("A", "result", "C", "in")];
    expect(conduitGhostSpecs(incoming, outgoing, existing)).toEqual([]);
  });

  it("dedups identical specs produced by different lanes", () => {
    const incoming = [conn("A", "result", "cd", "in_0"), conn("A", "result", "cd", "in_1")];
    const outgoing = [conn("cd", "out_0", "C", "in"), conn("cd", "out_1", "C", "in")];
    expect(conduitGhostSpecs(incoming, outgoing, [])).toEqual([conn("A", "result", "C", "in")]);
  });
});
