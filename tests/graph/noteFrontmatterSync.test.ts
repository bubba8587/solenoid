// [[D16]] retypeReconciles, [[E3]] adoptKeepsCables
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { pruneFrontmatterCables } from "../../src/graph/noteFrontmatterSync";
import { AdoptiveSocket, SolenoidSocket } from "../../src/graph/sockets";
import { reconcileTrueAnyTypes } from "../../src/graph/trueAnyAdopt";

function sink(socket: SolenoidSocket) {
  const n = new ClassicPreset.Node("Sink");
  n.addInput("in", new ClassicPreset.Input(socket, "In"));
  return n;
}

describe("a frontmatter retype judges each cable by the input's DECLARED rung", () => {
  it("keeps the cable into an adoptive input that adopted the old type; drops the one into a typed input", async () => {
    const editor = new NodeEditor() as never as NodeEditor<never>;
    const note = new NoteNode({ body: "---\nx: 5\n---" });
    const display = sink(new AdoptiveSocket());
    const typed = sink(new SolenoidSocket("number"));
    for (const n of [note, display, typed]) await editor.addNode(n as never);
    await editor.addConnection(new ClassicPreset.Connection(note as never, "x", display as never, "in") as never);
    await editor.addConnection(new ClassicPreset.Connection(note as never, "x", typed as never, "in") as never);
    reconcileTrueAnyTypes(editor as never);
    expect((display.inputs.in!.socket as AdoptiveSocket).dataType).toBe("number");

    note.body = "---\nx: hello\n---";
    const { removed, retyped } = note.syncFields();
    expect(retyped).toEqual([{ key: "x", type: "string" }]);
    await pruneFrontmatterCables(editor as never, note.id, removed, retyped);

    const targets = (editor as unknown as NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>)
      .getConnections().map((c) => c.target);
    expect(targets).toEqual([display.id]);
  });
});
