import { describe, it, expect } from "vitest";
import { evalPackFormula } from "./formulaTestKit";
import { IsInNode, TallyNode, AggregateNode } from "../rete-nodes";
import { joinFrames, type JoinOpts } from "../frameVerbs";
import { shapeOfJoin } from "../frameShape";
import { inferColumn, getColumn, type FrameValue } from "../frame";
import { solError, isSolError } from "../errorValue";

describe("IsInNode", () => {
  const run = (a: unknown[], b: unknown[]) =>
    new IsInNode().data({ a: [a], b: [b] }).result;

  it("masks membership aligned to A", () => {
    expect(run([1, 2, 3, 4], [2, 4, 9])).toEqual([false, true, false, true]);
    expect(run(["x", "y"], ["y"])).toEqual([false, true]);
  });

  it("A-side null stays null, error propagates; B-side blanks/errors aren't members", () => {
    const err = solError("#DIV/0!", "x");
    expect(run([1, null, err], [1, null, err])).toEqual([true, null, err]);
  });
});

describe("TallyNode", () => {
  it("counts distinct values in first-seen order", () => {
    const r = new TallyNode().data({ list: [["b", "a", "b", "c", "a", "b"]] }).frame as FrameValue;
    expect(getColumn(r, "Value")!.values).toEqual(["b", "a", "c"]);
    expect(getColumn(r, "Count")!.values).toEqual([3, 2, 1]);
  });

  it("numeric lists get a numeric Value column; blanks/errors don't count", () => {
    const r = new TallyNode().data({ list: [[5, 5, null, solError("#N/A", "x"), 7]] }).frame as FrameValue;
    expect(getColumn(r, "Value")!.type).toBe("number");
    expect(getColumn(r, "Value")!.values).toEqual([5, 7]);
    expect(getColumn(r, "Count")!.values).toEqual([2, 1]);
  });

  it("no input → blank", () => {
    expect(new TallyNode().data({}).frame).toBe(null);
  });
});

describe("pack formula functions (formulaNaming decision 4)", () => {
  it("ISIN masks membership aligned to the values list", () => {
    expect(evalPackFormula("ISIN(v, s)", { v: [1, 2, 3, 4], s: [2, 4, 9] }))
      .toEqual([false, true, false, true]);
  });
  it("TALLY returns counts per distinct value, first-seen order", () => {
    expect(evalPackFormula("TALLY(v)", { v: ["b", "a", "b", "c", "a", "b"] })).toEqual([3, 2, 1]);
  });
});

describe("COUNT DISTINCT aggregate op", () => {
  it("counts unique values, skipping nulls, propagating errors", () => {
    const n = new AggregateNode({ op: "countdistinct" });
    expect(n.data({ list: [[1, 2, 2, 3, 3, 3, null]] }).result).toBe(3);
    const err = solError("#N/A", "x");
    expect(n.data({ list: [[1, err]] }).result).toBe(err);
  });
});

describe("semi / anti join (JS oracle)", () => {
  const f = (cols: Record<string, unknown[]>): FrameValue => ({
    __frame: true,
    columns: Object.entries(cols).map(([name, values]) => inferColumn(name, values)),
  });
  const opts = (how: JoinOpts["how"]): JoinOpts => ({ leftKey: "id", rightKey: "fk", how });

  const left = f({ id: [1, 2, 3], a: ["p", "q", "r"] });
  const right = f({ fk: [2, 2], v: ["x", "y"] });

  it("semi keeps matching left rows, left columns only, no fan-out", () => {
    const out = joinFrames(left, right, opts("semi"));
    expect(out.columns.map((c) => c.name)).toEqual(["id", "a"]);
    expect(getColumn(out, "id")!.values).toEqual([2]);
    expect(getColumn(out, "a")!.values).toEqual(["q"]);
  });

  it("anti keeps non-matching left rows", () => {
    const out = joinFrames(left, right, opts("anti"));
    expect(getColumn(out, "id")!.values).toEqual([1, 3]);
    expect(getColumn(out, "a")!.values).toEqual(["p", "r"]);
  });

  it("null keys never match: dropped by semi, kept by anti", () => {
    const l = f({ id: [1, null], a: ["p", "q"] });
    const r = f({ fk: [1, null], v: ["x", "y"] });
    expect(getColumn(joinFrames(l, r, opts("semi")), "id")!.values).toEqual([1]);
    expect(getColumn(joinFrames(l, r, opts("anti")), "id")!.values).toEqual([null]);
  });

  it("shape declaration matches: left columns only", () => {
    const shape = shapeOfJoin(
      { columns: left.columns.map((c) => ({ name: c.name, type: c.type })) },
      { columns: right.columns.map((c) => ({ name: c.name, type: c.type })) },
      opts("semi"),
    );
    expect(shape.columns.map((c) => c.name)).toEqual(["id", "a"]);
  });

  it("missing key column still #REF!s", () => {
    expect(() => joinFrames(left, right, { leftKey: "nope", rightKey: "fk", how: "anti" })).toThrowError();
    try {
      joinFrames(left, right, { leftKey: "nope", rightKey: "fk", how: "anti" });
    } catch (e) {
      expect(isSolError(e)).toBe(true);
    }
  });
});
