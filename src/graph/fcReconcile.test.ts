import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { retypeOutputCables } from "./fcReconcile";
import { stringSocket, anySocket, numberSocket } from "./sockets";

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;
// reconcileFcTypes only calls area.update for FC/Convert nodes (none here), so a
// no-op stub suffices to exercise retypeOutputCables' cable-keep logic.
const stubArea = { update: async () => {} } as never;

describe("retypeOutputCables (Cast / LAMBDA / Get Column shared retype path)", () => {
  it("keeps a cable to an `any` input but drops a now-incompatible typed one", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const src = new ClassicPreset.Node("Src");
    src.addOutput("result", new ClassicPreset.Output(stringSocket, "Result")); // post-swap type = string
    const consAny = new ClassicPreset.Node("Any");
    consAny.addInput("in", new ClassicPreset.Input(anySocket, "In"));
    const consNum = new ClassicPreset.Node("Num");
    consNum.addInput("in", new ClassicPreset.Input(numberSocket, "In"));
    for (const n of [src, consAny, consNum]) await editor.addNode(n as never);
    const toAny = new ClassicPreset.Connection(src as never, "result", consAny as never, "in");
    const toNum = new ClassicPreset.Connection(src as never, "result", consNum as never, "in");
    await editor.addConnection(toAny as never);
    await editor.addConnection(toNum as never);

    await retypeOutputCables(editor as never, stubArea, src.id, "result");

    const ids = editor.getConnections().map((c) => c.id);
    expect(ids).toContain(toAny.id);   // string → any: kept
    expect(ids).not.toContain(toNum.id); // string → number: dropped (incompatible)
  });
});
