// [[D102]] graphOnCore
// The engine's own contract, as the app reads it: values cross by reference, a node's throw reaches the fetch as
// itself, a reset mid-fetch rejects with Cancelled, and nodes added before `use` are registered.
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphInput, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine, engineOf } from "../../src/graph/dataflowEngine";
import { Cancelled } from "../../src/graph/graphEditor";
import type { Schemes } from "../../src/graph/schemes";

type Data = (inputs: Record<string, unknown[]>) => unknown;

class N extends GraphNode {
  constructor(public run: Data, inputs: string[] = [], outputs: string[] = ["out"]) {
    super("n");
    for (const k of inputs) this.addInput(k, new GraphInput(new GraphSocket("s"), k, true));
    for (const k of outputs) this.addOutput(k, new GraphOutput(new GraphSocket("s")));
  }
  data(inputs: Record<string, unknown[]>) { return this.run(inputs); }
}

async function graph() {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>({ raw: true });
  editor.use(engine);
  const add = async (n: N) => { await editor.addNode(n as unknown as Schemes["Node"]); return n; };
  const wire = (a: N, out: string, b: N, input: string) =>
    editor.addConnection(new GraphConnection(a, out, b, input) as unknown as Schemes["Connection"]);
  return { editor, engine, add, wire };
}

describe("DataflowEngine on the graph core", () => {
  it("passes values by reference, one list per wired input", async () => {
    const { engine, add, wire } = await graph();
    const payload = { rows: [1, 2] };
    const a = await add(new N(() => ({ out: payload })));
    let seen: Record<string, unknown[]> = {};
    const b = await add(new N((i) => { seen = i; return { out: i.x[0] }; }, ["x", "y"]));
    await wire(a, "out", b, "x");
    const out = await engine.fetch(b.id);
    expect(out.out).toBe(payload);
    expect(seen.x[0]).toBe(payload);
    expect("y" in seen).toBe(false);
  });

  it("rejects a fetch with what data() threw, sync or async", async () => {
    const { engine, add } = await graph();
    const boom = new Error("boom");
    const sync = await add(new N(() => { throw boom; }));
    const later = await add(new N(async () => { throw boom; }));
    await expect(engine.fetch(sync.id)).rejects.toBe(boom);
    await expect(engine.fetch(later.id)).rejects.toBe(boom);
  });

  it("rejects with Cancelled when a reset clears a fetch in flight", async () => {
    const { engine, add } = await graph();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const a = await add(new N(async () => { await gate; return { out: 1 }; }));
    const pending = engine.fetch(a.id);
    await Promise.resolve();
    engine.reset();
    release();
    await expect(pending).rejects.toBeInstanceOf(Cancelled);
  });

  it("reads a Cancelled a node passes up as a cancellation", async () => {
    const { engine, add } = await graph();
    await add(new N(() => { throw new Cancelled(); }));
    expect(await engine.fetchAll(undefined, true)).toBeNull();
  });

  it("returns a seeded result without running the node", async () => {
    const { engine, add } = await graph();
    let runs = 0;
    const a = await add(new N(() => { runs++; return { out: 1 }; }));
    engine.seed(a.id, { out: 7 });
    expect((await engine.fetch(a.id)).out).toBe(7);
    expect(runs).toBe(0);
  });

  it("mirrors what the editor held before it was attached, and what leaves it", async () => {
    const editor = new GraphEditor<Schemes>();
    const a = new N(() => ({ out: 2 }));
    const b = new N((i) => ({ out: ((i.x?.[0] ?? 0) as number) * 10 }), ["x"]);
    await editor.addNode(a as unknown as Schemes["Node"]);
    await editor.addNode(b as unknown as Schemes["Node"]);
    await editor.addConnection(new GraphConnection(a, "out", b, "x") as unknown as Schemes["Connection"]);
    const engine = new DataflowEngine<Schemes>({ raw: true });
    editor.use(engine);
    expect(engineOf(editor)).toBe(engine);
    expect((await engine.fetch(b.id)).out).toBe(20);
    expect(engine.loopMembers().size).toBe(0);
    await editor.removeConnection(editor.getConnections()[0].id);
    await editor.removeNode(a.id);
    engine.reset();
    const values = await engine.fetchAll();
    expect([...values!.keys()]).toEqual([b.id]);
  });
});
