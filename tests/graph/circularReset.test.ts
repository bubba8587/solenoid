// [[C23]] calcModes, [[compute-pass#The model pass]]
import type { View } from "../../src/graph/view";
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { type SolError } from "../../src/graph/errorValue";
import { setEditorRefs, processGraph } from "../../src/graph/process";
import { cableValueStore } from "../../src/graph/cableValueStore";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";


function connect(
  editor: GraphEditor<Schemes>,
  src: GraphNode, srcOut: string, tgt: GraphNode, tgtIn: string,
) {
  return editor.addConnection(
    new GraphConnection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

function makeGraph() {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  // runGraphPass touches the view only via `area.rerenderNode(id)` — stub it.
  const view = { rerenderNode: async () => {} } as unknown as View;
  setEditorRefs(editor, engine, view);
  return { editor, engine };
}

describe("closing a cycle with a live cable (targeted topology pass)", () => {
  it("yields #CIRC! on the loop members instead of throwing a RangeError", async () => {
    const { editor } = makeGraph();
    const a = new ArithmeticNode({ op: "add" });
    const b = new ArithmeticNode({ op: "add" });
    await editor.addNode(a);
    await editor.addNode(b);
    await connect(editor, a, "result", b, "a");
    await connect(editor, b, "result", a, "a"); // this cable CLOSES the loop

    // As the canvas pipe does for a new cable: a targeted pass on its target with the topology flag.
    await expect(
      processGraph(a.id, undefined, { topology: true }),
    ).resolves.not.toThrow();

    // The loop members must carry the seeded #CIRC! error, like a full pass gives.
    for (const n of [a, b]) {
      const out = cableValueStore.get(n.id, "result");
      expect((out as SolError).code).toBe("#CIRC!");
      expect((n.cachedResult as SolError).code).toBe("#CIRC!");
    }
  });
});

describe("pasting a loop (additive pass)", () => {
  it("seeds #CIRC! on the pasted members instead of hanging on a stale loop set", async () => {
    const { editor } = makeGraph();
    const src = new ArithmeticNode({ op: "add" });
    await editor.addNode(src);
    await processGraph(); // caches a loop set with no members

    const a = new ArithmeticNode({ op: "add" });
    const b = new ArithmeticNode({ op: "add" });
    await editor.addNode(a);
    await editor.addNode(b);
    await connect(editor, a, "result", b, "a");
    await connect(editor, b, "result", a, "a");

    const settled = processGraph(undefined, new Set([a.id, b.id])).then(() => "settled");
    const timeout = new Promise((r) => setTimeout(() => r("hung"), 500));
    expect(await Promise.race([settled, timeout])).toBe("settled");
    for (const n of [a, b]) expect((cableValueStore.get(n.id, "result") as SolError).code).toBe("#CIRC!");
  });
});

// A card that answers after a moment, as a Script card in its Worker or a Web Source does.
class Slow extends GraphNode {
  constructor() {
    super("slow");
    this.addOutput("out", new GraphOutput(new GraphSocket("number")));
  }
  async data() {
    await new Promise((r) => setTimeout(r, 5));
    return { out: 1 };
  }
}

describe("a cable that closes a loop while a pass waits", () => {
  it("is seeded #CIRC! before the pass fetches into it, so the pass settles", async () => {
    const { editor } = makeGraph();
    const slow = new Slow();
    const a = new ArithmeticNode({ op: "add" });
    const b = new ArithmeticNode({ op: "add" });
    for (const n of [slow, a, b]) await editor.addNode(n as unknown as Schemes["Node"]);
    await connect(editor, slow, "out", a, "a");
    await connect(editor, a, "result", b, "a");

    const settled = processGraph().then(() => "settled");
    await connect(editor, b, "result", a, "b"); // closes the loop while the slow card waits
    const timeout = new Promise((r) => setTimeout(() => r("hung"), 1000));
    expect(await Promise.race([settled, timeout])).toBe("settled");
    await processGraph();
    for (const n of [a, b]) expect((cableValueStore.get(n.id, "result") as SolError).code).toBe("#CIRC!");
  });
});
