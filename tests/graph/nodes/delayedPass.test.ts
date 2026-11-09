// [[D118]] delayedPass, [[compute-pass#Delayed Pass]]
import { describe, it, expect } from "vitest";
import type { View } from "../../../src/graph/view";
import { GraphEditor } from "../../../src/graph/graphEditor";
import { GraphConnection, type GraphNode } from "../../../src/graph/graphModel";
import { DataflowEngine } from "../../../src/graph/dataflowEngine";
import type { Schemes } from "../../../src/graph/schemes";
import { setEditorRefs, processGraph } from "../../../src/graph/process";
import { ArithmeticNode } from "../../../src/graph/nodes/scalar";
import { DelayedPassNode, ValueInputNode } from "../../../src/graph/nodes/control";
import { validateGraph } from "../../../src/graph/graphValidate";
import type { SavedGraph } from "../../../src/graph/persistence";

function connect(editor: GraphEditor<Schemes>, src: GraphNode, out: string, tgt: GraphNode, inp: string) {
  return editor.addConnection(new GraphConnection(src, out, tgt, inp) as Schemes["Connection"]);
}

async function counter() {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
  const d = new DelayedPassNode();
  const add = new ArithmeticNode({ op: "add" });
  add.literals = { b: 1 };
  await editor.addNode(d);
  await editor.addNode(add);
  await connect(editor, d, "out", add, "a");
  await connect(editor, add, "result", d, "in");
  return { editor, engine, d, add };
}

describe("Delayed Pass (DelayedPassNode)", () => {
  it("a loop through it steps once per recalculation instead of reading #CIRC!", async () => {
    const { engine, d, add } = await counter();
    expect(engine.loopMembers().size).toBe(0);
    await processGraph(add.id, undefined, { topology: true });
    expect(add.cachedResult).toBe(1);
    await processGraph();
    expect(add.cachedResult).toBe(2);
    await processGraph();
    expect(add.cachedResult).toBe(3);
    expect(d.cachedValue).toBe(2);
    expect(d.stepCount).toBe(3);
  });

  it("an edit elsewhere steps it too, through a targeted pass", async () => {
    const { editor, add } = await counter();
    const other = new ValueInputNode({ value: "5" });
    await editor.addNode(other);
    await processGraph();
    await processGraph(other.id);
    expect(add.cachedResult).toBe(2);
  });

  it("Reset starts the loop again from Start", async () => {
    const { engine, d, add } = await counter();
    await processGraph();
    await processGraph();
    d.reset();
    engine.invalidate(d.id, false);
    await processGraph(d.id);
    expect(add.cachedResult).toBe(1);
    expect(d.stepCount).toBe(1);
  });

  it("a cycle through it is no cycle to the text validator", () => {
    const g = {
      nodes: [
        { id: "d", type: "DelayedPassNode", init: {} },
        { id: "a", type: "ArithmeticNode", init: { op: "add" } },
      ],
      connections: [
        { source: "d", sourceOutput: "out", target: "a", targetInput: "a" },
        { source: "a", sourceOutput: "result", target: "d", targetInput: "in" },
      ],
    } as unknown as SavedGraph;
    expect(validateGraph(g).some((i) => i.message.includes("dependency cycle"))).toBe(false);
  });
});
