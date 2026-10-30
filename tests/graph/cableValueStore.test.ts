// [[A1]] visualGraphCalculator, [[C130]] rustCore
// The cable readouts read each output as the last pass landed it in the core that ran it, and only `bump()` tells
// subscribers (graph-core.md § Direct calls).
import { describe, expect, it, vi } from "vitest";
import { cableValueStore } from "../../src/graph/cableValueStore";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";

class Src extends GraphNode {
  constructor(public out: Record<string, unknown>) {
    super("src");
    for (const k of Object.keys(out)) this.addOutput(k, new GraphOutput(new GraphSocket("s")));
  }
  data() { return this.out; }
}

async function stage(...nodes: Src[]) {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  for (const n of nodes) await editor.addNode(n as unknown as Schemes["Node"]);
  cableValueStore.readFrom(engine);
  return { editor, engine };
}

describe("cableValueStore", () => {
  it("reads each output as the last pass landed it, any value type", async () => {
    const arr = [1, 2, 3];
    const n1 = new Src({ arr, nil: null, flag: false, out: 1 });
    const n2 = new Src({ out: 20 });
    const { engine } = await stage(n1, n2);
    await engine.pass(undefined, undefined, false);
    n1.out = { arr, nil: null, flag: false, out: 99 };
    await engine.pass(n1.id, undefined, false);
    expect(cableValueStore.get(n1.id, "arr")).toBe(arr);
    expect(cableValueStore.get(n1.id, "nil")).toBeNull();
    expect(cableValueStore.get(n1.id, "flag")).toBe(false);
    expect(cableValueStore.get(n1.id, "out")).toBe(99);
    expect(cableValueStore.get(n2.id, "out")).toBe(20);
    expect(cableValueStore.get(n1.id, "other")).toBeUndefined();
  });

  it("forgets a node that leaves its editor", async () => {
    const n = new Src({ out: 5 });
    const { editor, engine } = await stage(n);
    await engine.pass(undefined, undefined, false);
    expect(cableValueStore.get(n.id, "out")).toBe(5);
    await editor.removeNode(n.id);
    expect(cableValueStore.get(n.id, "out")).toBeUndefined();
  });

  it("bump bumps the version and notifies; a pass alone does not; unsubscribe stops delivery", async () => {
    const fn = vi.fn();
    const unsub = cableValueStore.subscribe(fn);
    const v0 = cableValueStore.version();
    const { engine } = await stage(new Src({ out: 1 }));
    await engine.pass(undefined, undefined, false);
    expect(cableValueStore.version()).toBe(v0);
    cableValueStore.bump();
    expect(cableValueStore.version()).toBe(v0 + 1);
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    cableValueStore.bump();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
