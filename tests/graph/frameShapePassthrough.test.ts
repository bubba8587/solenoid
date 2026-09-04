import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { makeFrameShapeResolver } from "../../src/graph/frameShapeResolver";
import { FrameInputNode, SortFrameNode, DecisionMatrixNode } from "../../src/graph/nodes/frame";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { DisplayNode } from "../../src/graph/nodes/display";
import { IfNode } from "../../src/graph/nodes/logic";
import { ConduitNode, conduitInKey, conduitOutKey } from "../../src/graph/nodes/conduit";
import type { Schemes } from "../../src/graph/schemes";

const FRAME_TEXT = "Name, Qty\nA, 1\nB, 2";

async function chain(mid: (e: NodeEditor<Schemes>) => Promise<{ node: Schemes["Node"]; inKey: string; outKey: string }>) {
  const editor = new NodeEditor<Schemes>();
  const src = new FrameInputNode() as unknown as Schemes["Node"];
  (src as unknown as FrameInputNode).frameText = FRAME_TEXT;
  await editor.addNode(src);
  const m = await mid(editor);
  await editor.addConnection(new ClassicPreset.Connection(src, "frame", m.node, m.inKey) as Schemes["Connection"]);
  const sort = new SortFrameNode() as unknown as Schemes["Node"];
  await editor.addNode(sort);
  await editor.addConnection(new ClassicPreset.Connection(m.node, m.outKey, sort, "frame") as Schemes["Connection"]);
  const r = makeFrameShapeResolver(editor as never);
  return { direct: r.outShape(src.id, "frame"), viaMid: r.outShape(m.node.id, m.outKey), downstream: r.outShape(sort.id, "frame") };
}

describe("frame SHAPE survives a passthrough (Bug B)", () => {
  const cols = (s: { columns: { name: string }[] } | null) => s?.columns.map((c) => c.name) ?? null;

  it("the source itself resolves (control)", async () => {
    const r = await chain(async (e) => {
      const d = new DisplayNode() as unknown as Schemes["Node"];
      await e.addNode(d);
      return { node: d, inKey: "in", outKey: "out" };
    });
    expect(cols(r.direct)).toEqual(["Name", "Qty"]);
  });

  it("through a Display", async () => {
    const r = await chain(async (e) => {
      const d = new DisplayNode() as unknown as Schemes["Node"];
      await e.addNode(d);
      return { node: d, inKey: "in", outKey: "out" };
    });
    expect(cols(r.viaMid)).toEqual(["Name", "Qty"]);
    expect(cols(r.downstream)).toEqual(["Name", "Qty"]);
  });

  it("through a Conduit lane", async () => {
    const r = await chain(async (e) => {
      const c = new ConduitNode({}) as unknown as Schemes["Node"];
      await e.addNode(c);
      return { node: c, inKey: conduitInKey(0), outKey: conduitOutKey(0) };
    });
    expect(cols(r.viaMid)).toEqual(["Name", "Qty"]);
    expect(cols(r.downstream)).toEqual(["Name", "Qty"]);
  });

  it("through an IF with only one branch wired", async () => {
    const r = await chain(async (e) => {
      const i = new IfNode() as unknown as Schemes["Node"];
      await e.addNode(i);
      return { node: i, inKey: "then", outKey: "result" };
    });
    expect(cols(r.viaMid)).toEqual(["Name", "Qty"]);
  });
});

describe("frame PRODUCERS carry their column types into the static shape", () => {
  it("a Note frame frontmatter key resolves to its typed columns", async () => {
    const editor = new NodeEditor<Schemes>();
    const note = new NoteNode({ body: "---\nt:\n  - {Name: A, Qty: 1}\n  - {Name: B, Qty: 2}\n---" }) as unknown as Schemes["Node"];
    await editor.addNode(note);
    const s = makeFrameShapeResolver(editor as never).outShape(note.id, "t");
    expect(s?.columns).toEqual([{ name: "Name", type: "string" }, { name: "Qty", type: "number" }]);
  });

  it("Decision Matrix types the label string first, Score/Rank number (breakdown adds criteria)", async () => {
    const editor = new NodeEditor<Schemes>();
    const src = new FrameInputNode() as unknown as Schemes["Node"];
    (src as unknown as FrameInputNode).frameText = "Option, A, B\nx, 1, 2\ny, 3, 4";
    await editor.addNode(src);
    const dm = new DecisionMatrixNode({ detail: "breakdown" }) as unknown as Schemes["Node"];
    await editor.addNode(dm);
    await editor.addConnection(new ClassicPreset.Connection(src, "frame", dm, "frame") as Schemes["Connection"]);
    const s = makeFrameShapeResolver(editor as never).outShape(dm.id, "frame");
    expect(s?.columns).toEqual([
      { name: "Option", type: "string" },
      { name: "A", type: "number" },
      { name: "B", type: "number" },
      { name: "Score", type: "number" },
      { name: "Rank", type: "number" },
    ]);
  });
});
