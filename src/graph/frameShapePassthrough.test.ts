import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { makeFrameShapeResolver } from "./frameShapeResolver";
import { FrameInputNode, SortFrameNode } from "./nodes/frame";
import { DisplayNode } from "./nodes/display";
import { IfNode } from "./nodes/logic";
import { ConduitNode, conduitInKey, conduitOutKey } from "./nodes/conduit";
import type { Schemes } from "./schemes";

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
