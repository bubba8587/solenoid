import { describe, it, expect } from "vitest";
import { StackNode } from "../../../src/graph/nodes/matrix";
import { ConcatListsNode } from "../../../src/graph/nodes/list";
import { FrameFromListsNode, AppendNode, FilterFrameNode } from "../../../src/graph/nodes/frame";
import { QuadraticRootsNode, cx } from "../../../src/graph/nodes/complex";
import { isSolError } from "../../../src/graph/errorValue";
import { frameFromCells, type FrameValue } from "../../../src/graph/frame";
import { readFrame } from "../../../src/graph/frameBackend";
import { wrapNodeData } from "../../../src/graph/coerceInputs";

describe("VSTACK stacks; Concat appends (the Excel row semantics)", () => {
  it("two lists VSTACK into a 2-row table (a list is one row)", () => {
    const r = new StackNode({ op: "vstack" }).data({ t0: [[1, 2, 3]], t1: [[4, 5, 6]] }).result;
    expect(r).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("two lists HSTACK into one long row", () => {
    const r = new StackNode({ op: "hstack" }).data({ t0: [[1, 2]], t1: [[3, 4, 5]] }).result;
    expect(r).toEqual([[1, 2, 3, 4, 5]]);
  });

  it("VSTACK stacks tables and mixes a table with a list row", () => {
    const table = [[1, 2], [3, 4]];
    expect(new StackNode({ op: "vstack" }).data({ t0: [table], t1: [[5, 6]] }).result)
      .toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("a narrower input pads right with #N/A (Excel VSTACK), not #SHAPE!", () => {
    const r = new StackNode({ op: "vstack" }).data({ t0: [[1, 2]], t1: [[1, 2, 3]] }).result as unknown[][];
    expect(r[0].slice(0, 2)).toEqual([1, 2]);
    expect(isSolError(r[0][2])).toBe(true);
    expect(r[1]).toEqual([1, 2, 3]);
    expect(new StackNode({ op: "vstack" }).data({ t0: [[1, 2]] }).result).toEqual([[1, 2]]);
  });

  it("a shorter HSTACK input pads down with #N/A (Excel HSTACK)", () => {
    const r = new StackNode({ op: "hstack" }).data({ t0: [[[1], [2]]], t1: [[[9]]] }).result as unknown[][];
    expect(r[0]).toEqual([1, 9]);
    expect(r[1][0]).toBe(2);
    expect(isSolError(r[1][1])).toBe(true);
  });

  it("stacking is N-ary: a third row joins the stack in row order", () => {
    const n = new StackNode({ op: "vstack" });
    n.addValueInput(); // t2
    expect(n.data({ t0: [[1, 2]], t1: [[3, 4]], t2: [[5, 6]] }).result)
      .toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("Concat Lists keeps the end-to-end join, N-ary and element-agnostic", () => {
    expect(new ConcatListsNode().data({ l0: [[1, 2]], l1: [[3]] }).result).toEqual([1, 2, 3]);
    const n = new ConcatListsNode();
    n.addValueInput(); // l2
    expect(n.data({ l0: [["a"]], l1: [[1, 2]], l2: [[true]] }).result).toEqual(["a", 1, 2, true]);
  });

  it("stackers round-trip their rows through valueKeys (persistence contract)", () => {
    const n = new StackNode({ op: "vstack" });
    n.addValueInput();
    const keys = Object.keys(n.inputs).filter((k) => k.startsWith("t"));
    const clone = new StackNode({ op: "vstack",  valueKeys: keys });
    expect(clone.valueInputKeys()).toEqual(keys);
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

describe("Frame Append — N-ary, by column name", () => {
  const mk = (vals: number[]): FrameValue => frameFromCells(["x"], vals.map((v) => [v]));

  it("stacks three frames in row order", async () => {
    const n = new AppendNode();
    n.addValueInput(); // f2
    const out = await n.data({ f0: [mk([1])], f1: [mk([2, 3])], f2: [mk([4])] });
    // The append result is a LAZY ref — materialize it like a consumer would.
    const f = (await readFrame(out.frame)) as FrameValue;
    expect(f.columns[0].values).toEqual([1, 2, 3, 4]);
  });

  it("one wired frame passes through; none is blank", async () => {
    const n = new AppendNode();
    const solo = (await readFrame((await n.data({ f0: [mk([7])] })).frame)) as FrameValue;
    expect(solo.columns[0].values).toEqual([7]);
    expect((await n.data({})).frame).toBe(null);
  });
});

describe("the filterOneJob table-filter route: a MATRIX widens into the frame Filter", () => {
  it("filters a bare matrix's rows by Col2 — no Build Frame needed", async () => {
    const n = new FilterFrameNode({
      valueKeys: ["column0", "value0"],
      condConfig: { "0": { op: "gt" } },
    });
    n.stringLiterals.column0 = "Col2";
    n.stringLiterals.value0 = "10";
    wrapNodeData(n as never);
    const out = await (n.data as (i: unknown) => Promise<{ frame: unknown }>)({
      frame: [[[1, 5], [2, 20], [3, 30]]],
    });
    const f = (await readFrame(out.frame as never)) as FrameValue;
    expect(f.columns.map((c) => c.name)).toEqual(["Col1", "Col2"]);
    expect(f.columns[1].values).toEqual([20, 30]);
  });
});

describe("Quadratic Roots (complex)", () => {
  it("real roots come out as real complex numbers", () => {
    const r = new QuadraticRootsNode().data({ a: [1], b: [0], c: [-36] });
    expect(r.x1).toEqual(cx(-6, 0));
    expect(r.x2).toEqual(cx(6, 0));
  });

  it("a negative discriminant gives the conjugate pair", () => {
    // x² + 2x + 5 = 0 → −1 ± 2i.
    const r = new QuadraticRootsNode().data({ a: [1], b: [2], c: [5] });
    expect(r.x1).toEqual(cx(-1, -2));
    expect(r.x2).toEqual(cx(-1, 2));
  });

  it("the node's default x² + 1 = 0 shows ±i; a = 0 errors", () => {
    const dflt = new QuadraticRootsNode().data({});
    expect(dflt.x1).toEqual(cx(0, -1));
    expect(dflt.x2).toEqual(cx(0, 1));
    expect(isSolError(new QuadraticRootsNode().data({ a: [0], b: [2], c: [1] }).x1)).toBe(true);
  });
});
