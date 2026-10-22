// [[D102]] graphOnCore
// A panic in the graph core rejects what was waiting on it, and a fresh instance takes over with every live
// engine's editor mirrored into it (tree/specs/computation/graph-core.md § Traps).
import { it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine, GraphTrap } from "../../src/graph/dataflowEngine";
import { graphTrap } from "../../src/graph/graphWasm/solenoid_graph.js";
import type { Schemes } from "../../src/graph/schemes";

class N extends ClassicPreset.Node {
  constructor(public run: (inputs: Record<string, unknown[]>) => unknown, input = false) {
    super("n");
    if (input) this.addInput("x", new ClassicPreset.Input(new ClassicPreset.Socket("s")));
    this.addOutput("out", new ClassicPreset.Output(new ClassicPreset.Socket("s")));
  }
  data(inputs: Record<string, unknown[]>) { return this.run(inputs); }
}

it("a trap rejects the fetch in flight, and the engine computes again on a fresh instance", async () => {
  const editor = new NodeEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const a = new N(async () => { await gate; return { out: 2 }; });
  const b = new N((i) => ({ out: (i.x?.[0] as number) * 10 }), true);
  await editor.addNode(a as unknown as Schemes["Node"]);
  await editor.addNode(b as unknown as Schemes["Node"]);
  await editor.addConnection(new ClassicPreset.Connection(a, "out", b, "x") as unknown as Schemes["Connection"]);

  const pending = engine.fetch(b.id);
  expect(() => graphTrap()).toThrow();
  await expect(pending).rejects.toBeInstanceOf(GraphTrap);
  release();
  await Promise.resolve();

  expect((await engine.fetch(b.id)).out).toBe(20);
  expect(engine.loopMembers().size).toBe(0);
});
