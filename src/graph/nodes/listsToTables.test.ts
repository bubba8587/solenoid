import { describe, it, expect } from "vitest";
import { VStackNode, HStackTableNode } from "./matrix";
import { ConcatListsNode } from "./list";
import { FrameFromListsNode } from "./frame";
import { QuadraticRootsNode } from "./complex";
import { isSolError } from "../errorValue";
import type { FrameValue } from "../frame";

describe("VSTACK stacks; Concat appends (the Excel row semantics)", () => {
  it("two lists VSTACK into a 2-row table (a list is one row)", () => {
    const r = new VStackNode().data({ a: [[1, 2, 3]], b: [[4, 5, 6]] }).result;
    expect(r).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("two lists HSTACK into one long row", () => {
    const r = new HStackTableNode().data({ a: [[1, 2]], b: [[3, 4, 5]] }).result;
    expect(r).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("VSTACK stacks tables and mixes a table with a list row", () => {
    const table = [[1, 2], [3, 4]];
    expect(new VStackNode().data({ a: [table], b: [[5, 6]] }).result)
      .toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("column-count mismatch is #SHAPE!; a missing side is blank", () => {
    expect(isSolError(new VStackNode().data({ a: [[1, 2]], b: [[1, 2, 3]] }).result)).toBe(true);
    expect(new VStackNode().data({ a: [[1, 2]] }).result).toBe(null);
  });

  it("Concat Lists keeps the old end-to-end join", () => {
    expect(new ConcatListsNode().data({ a: [[1, 2]], b: [[3]] }).result).toEqual([1, 2, 3]);
  });
});

describe("Frame from Lists — the fast lists→Frame path", () => {
  const build = (cols: Array<[string, unknown[]]>): FrameValue | null => {
    const n = new FrameFromListsNode();
    while (n.valuePairKeys().length < cols.length) n.addValuePair();
    const inputs: Record<string, unknown[]> = {};
    cols.forEach(([name, cells], i) => {
      n.stringLiterals[`name${i}`] = name;
      inputs[`vals${i}`] = [cells];
    });
    return n.data(inputs).frame as FrameValue | null;
  };

  it("named typed columns come out type-preserved", () => {
    const f = build([["City", ["Oslo", "Rome"]], ["Pop", [0.7, 2.8]], ["EU", [false, true]]])!;
    expect(f.columns.map((c) => c.name)).toEqual(["City", "Pop", "EU"]);
    expect(f.columns.map((c) => c.type)).toEqual(["string", "number", "logical"]);
    expect(f.columns[1].values).toEqual([0.7, 2.8]);
    // A typed string that LOOKS numeric stays a string (no re-inference).
    const g = build([["Code", ["01", "02"]]])!;
    expect(g.columns[0].type).toBe("string");
    expect(g.columns[0].values).toEqual(["01", "02"]);
  });

  it("ragged columns pad with blanks; blank names auto-fill and dedupe", () => {
    const f = build([["", [1, 2, 3]], ["", [9]]])!;
    expect(f.columns[0].name).not.toBe(f.columns[1].name);
    expect(f.columns[1].values).toEqual([9, null, null]);
  });

  it("unwired rows contribute nothing; no wired lists → blank", () => {
    const n = new FrameFromListsNode(); // 2 default pairs, nothing wired
    expect(n.data({}).frame).toBe(null);
    const f = n.data({ vals0: [[1, 2]] }).frame as FrameValue;
    expect(f.columns).toHaveLength(1);
  });

  it("identity-stable across passes with unchanged inputs (backend cache contract)", () => {
    const n = new FrameFromListsNode();
    const cells = [1, 2, 3];
    const a = n.data({ vals0: [cells] }).frame;
    const b = n.data({ vals0: [cells] }).frame;
    expect(b).toBe(a);
    const c = n.data({ vals0: [[9]] }).frame;
    expect(c).not.toBe(a);
  });

  it("valueKeys round-trip rebuilds the same pairs (persistence contract)", () => {
    const n = new FrameFromListsNode();
    n.addValuePair();
    const keys = Object.keys(n.inputs);
    const clone = new FrameFromListsNode({ valueKeys: keys });
    expect(Object.keys(clone.inputs)).toEqual(keys);
  });
});

describe("Quadratic Roots (complex)", () => {
  it("real roots come out as real complex numbers", () => {
    const r = new QuadraticRootsNode().data({ a: [1], b: [0], c: [-36] });
    expect(r.x1).toEqual([-6, 0]);
    expect(r.x2).toEqual([6, 0]);
  });

  it("a negative discriminant gives the conjugate pair", () => {
    // x² + 2x + 5 = 0 → −1 ± 2i.
    const r = new QuadraticRootsNode().data({ a: [1], b: [2], c: [5] });
    expect(r.x1).toEqual([-1, -2]);
    expect(r.x2).toEqual([-1, 2]);
  });

  it("the node's default x² + 1 = 0 shows ±i; a = 0 errors", () => {
    const dflt = new QuadraticRootsNode().data({});
    expect(dflt.x1).toEqual([0, -1]);
    expect(dflt.x2).toEqual([0, 1]);
    expect(isSolError(new QuadraticRootsNode().data({ a: [0], b: [2], c: [1] }).x1)).toBe(true);
  });
});
