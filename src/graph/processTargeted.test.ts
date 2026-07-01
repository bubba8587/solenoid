import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "./schemes";
import { downstreamClosure } from "./process";

// Guards the correctness pillar of the TARGETED processGraph path (A1/A2): the
// downstream closure must equal the set rete-engine's reset(nodeId) invalidates, so
// re-rendering only that cone never leaves a downstream node stale. Pure topology —
// no compute/area needed (so it runs in the node test env).
function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

// A minimal passthrough node with one input + one output, enough to wire a graph.
class Wire extends ClassicPreset.Node {
  constructor(label: string) {
    super(label);
    this.addInput("in", new ClassicPreset.Input(new ClassicPreset.Socket("s")));
    this.addOutput("out", new ClassicPreset.Output(new ClassicPreset.Socket("s")));
  }
}

describe("downstreamClosure (targeted recompute cone)", () => {
  it("includes the start node and every transitive dependent, across branches/joins", async () => {
    const editor = new NodeEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    // A → B → D,  A → C → D  (diamond),  plus isolated E.
    const A = new Wire("A"), B = new Wire("B"), C = new Wire("C"), D = new Wire("D"), E = new Wire("E");
    for (const n of [A, B, C, D, E]) await editor.addNode(n as Schemes["Node"]);
    await connect(editor, A, "out", B, "in");
    await connect(editor, A, "out", C, "in");
    await connect(editor, B, "out", D, "in");
    await connect(editor, C, "out", D, "in");

    const fromA = downstreamClosure(editor, A.id);
    expect([...fromA].sort()).toEqual([A.id, B.id, C.id, D.id].sort());
    expect(fromA.has(E.id)).toBe(false); // unrelated branch is NOT re-rendered

    // A mid-graph node's cone is just itself + what it feeds (the join D), not its
    // siblings or anything upstream.
    const fromB = downstreamClosure(editor, B.id);
    expect([...fromB].sort()).toEqual([B.id, D.id].sort());
    expect(fromB.has(A.id)).toBe(false);
    expect(fromB.has(C.id)).toBe(false);
  });

  it("terminates on a cycle instead of looping forever", async () => {
    const editor = new NodeEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    const X = new Wire("X"), Y = new Wire("Y");
    for (const n of [X, Y]) await editor.addNode(n as Schemes["Node"]);
    await connect(editor, X, "out", Y, "in");
    // Close the loop Y → X via a second port so it's a distinct connection.
    Y.addOutput("out2", new ClassicPreset.Output(new ClassicPreset.Socket("s")));
    X.addInput("in2", new ClassicPreset.Input(new ClassicPreset.Socket("s")));
    await connect(editor, Y, "out2", X, "in2");

    const cone = downstreamClosure(editor, X.id);
    expect([...cone].sort()).toEqual([X.id, Y.id].sort());
  });
});
