// [[B11]] maximalMerge, [[C10]] socketLattice
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphInput, GraphNode } from "../../src/graph/graphModel";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { pruneFrontmatterCables } from "../../src/graph/noteFrontmatterSync";
import { AdoptiveSocket, SolenoidSocket } from "../../src/graph/sockets";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";

function sink(socket: SolenoidSocket) {
  const n = new GraphNode("Sink");
  n.addInput("in", new GraphInput(socket, "In"));
  return n;
}

describe("a frontmatter retype judges each cable by the input's DECLARED rung", () => {
  it("keeps the cable into an adoptive input that adopted the old type; drops the one into a typed input", async () => {
    const editor = new GraphEditor() as never as GraphEditor<never>;
    const note = new NoteNode({ body: "---\nx: 5\n---" });
    const display = sink(new AdoptiveSocket());
    const typed = sink(new SolenoidSocket("number"));
    for (const n of [note, display, typed]) await editor.addNode(n as never);
    await editor.addConnection(new GraphConnection(note as never, "x", display as never, "in") as never);
    await editor.addConnection(new GraphConnection(note as never, "x", typed as never, "in") as never);
    settleWildcardTypes(editor as never);
    expect((display.inputs.in!.socket as AdoptiveSocket).dataType).toBe("number");

    note.body = "---\nx: hello\n---";
    const { removed, retyped } = note.syncFields();
    expect(retyped).toEqual([{ key: "x", type: "string" }]);
    await pruneFrontmatterCables(editor as never, note.id, removed, retyped);

    const targets = (editor as unknown as GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>)
      .getConnections().map((c) => c.target);
    expect(targets).toEqual([display.id]);
  });
});
