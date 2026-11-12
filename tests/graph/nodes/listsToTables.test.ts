import { describe, it, expect } from "vitest";
import { StackNode } from "../../../src/graph/nodes/matrix";
import { ConcatListsNode } from "../../../src/graph/nodes/list";
import { FrameFromListsNode, AppendNode, FilterFrameNode } from "../../../src/graph/nodes/frame";
import { frameFromCells, type FrameValue } from "../../../src/graph/frame";
import { readFrame } from "../../../src/graph/frameBackend";
import { isSolError } from "../../../src/graph/errorValue";
import { throughBoundary } from "../boundaryKit";
import { GraphEditor } from "../../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, GraphSocket } from "../../../src/graph/graphModel";
import { DataflowEngine } from "../../../src/graph/dataflowEngine";
import type { Schemes } from "../../../src/graph/schemes";

class Src extends GraphNode {
  constructor(public out: unknown) { super("src"); this.addOutput("out", new GraphOutput(new GraphSocket("numlist"))); }
  data() { return { out: this.out }; }
}

describe("VSTACK stacks; Concat appends (the Excel row semantics)", () => {




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

  it("a table where a list goes is #TYPE! naming the input, not a failed card", () => {
    // TAKE's output is untyped until it has run, so a table's last row (a 1 × 3 table) can be wired in.
    const f = build([["a", [[1, 2, 3]]]]) as unknown as { code: string; message: string };
    expect(isSolError(f) && f.code).toBe("#TYPE!");
    expect(f.message).toMatch(/takes a list, and this is a table\. TOROW or TOCOL makes a table a list$/);
  });

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


  it("identity-stable across passes with unchanged inputs (backend cache contract)", async () => {
    // The engine keeps the card's answer while its call and inputs stand (`nodes::KEEPS_ANSWER`), so a full pass
    // that recomputes everything hands on the same frame and the backend doesn't upload it again.
    const editor = new GraphEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    const src = new Src([1, 2, 3]), n = new FrameFromListsNode();
    await editor.addNode(src as never);
    await editor.addNode(n as never);
    await editor.addConnection(new GraphConnection(src, "out", n, "vals0") as never);
    const pass = async () => { await editor.engine!.pass(undefined, undefined, false); return editor.engine!.landed(n.id, "frame"); };
    const a = await pass();
    expect(await pass()).toBe(a);
    src.out = [9];
    expect(await pass()).not.toBe(a);
    editor.dispose();
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

describe("the [[C49]] filterOneJob table-filter route: a MATRIX widens into the frame Filter", () => {
  it("filters a bare matrix's rows by Col2 — no Build Frame needed", async () => {
    const n = new FilterFrameNode({
      valueKeys: ["column0", "value0"],
      condConfig: { "0": { op: "gt" } },
    });
    n.stringLiterals.column0 = "Col2";
    n.stringLiterals.value0 = "10";
    throughBoundary(n as never);
    const out = await (n.data as unknown as (i: unknown) => Promise<{ frame: unknown }>)({
      frame: [[[1, 5], [2, 20], [3, 30]]],
    });
    const f = (await readFrame(out.frame as never)) as FrameValue;
    expect(f.columns.map((c) => c.name)).toEqual(["Col1", "Col2"]);
    expect(f.columns[1].values).toEqual([20, 30]);
  });
});

