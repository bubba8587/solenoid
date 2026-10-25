// [[D102]] graphOnCore
// A freed editor lets go of its graph: the core holds the nodes, cables and pipes as JavaScript values the garbage
// collector can't reach past, so `dispose` frees it, and a composite leaving its editor frees its own. The fields the
// core held go back to their nodes, and a freed editor used again builds a core from them (graph-core.md § The model).
import { describe, it, expect } from "vitest";
import * as v8 from "node:v8";
import * as vm from "node:vm";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import { ValueInputNode } from "../../src/graph/nodes/control";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import type { Schemes } from "../../src/graph/schemes";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

async function collected(ref: WeakRef<object>): Promise<boolean> {
  for (let i = 0; i < 10 && ref.deref(); i++) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
  }
  return ref.deref() === undefined;
}

async function product(a: string, b: string) {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const x = new ValueInputNode({ value: a }), y = new ValueInputNode({ value: b }), mul = new ArithmeticNode({ op: "mul" });
  for (const n of [x, y, mul]) await editor.addNode(n as never);
  await editor.addConnection(new GraphConnection(x, "value", mul, "a") as never);
  await editor.addConnection(new GraphConnection(y, "value", mul, "b") as never);
  await engine.pass(undefined, undefined, false);
  editor.addPipe((s) => s);
  return { editor, engine, mul };
}

const shown = (n: object) => (n as { cachedResult?: unknown }).cachedResult;

describe("GraphEditor.dispose", () => {
  it("frees the graph a dropped editor held; without it the graph stays", async () => {
    const kept = await product("2", "3");
    const keptRef = new WeakRef(kept.mul);
    const freed = await product("2", "3");
    const freedRef = new WeakRef(freed.mul);
    freed.editor.dispose();
    kept.editor = kept.engine = kept.mul = freed.editor = freed.engine = freed.mul = undefined as never;
    expect(await collected(freedRef)).toBe(true);
    expect(keptRef.deref()).toBeDefined();
  });

  it("hands each field back to its node, and builds a core again when used", async () => {
    const { editor, engine, mul } = await product("2", "3");
    const before = shown(mul);
    expect(before).toBeDefined();
    editor.dispose();
    expect(Object.getOwnPropertyDescriptor(mul, "cachedResult")).toHaveProperty("value", before);
    await engine.pass(undefined, undefined, false);
    expect(shown(mul)).toEqual(before);
    expect(editor.coreIds().nodes).toHaveLength(3);
  });

  it("frees a composite's editor when the composite leaves its editor", async () => {
    const main = new GraphEditor<Schemes>();
    main.use(new DataflowEngine<Schemes>());
    let comp: CompositeNode | undefined = new CompositeNode();
    await comp.hydrate(ctorRegistry());
    await comp.internalEditor.addNode(new ValueInputNode({ value: "4" }) as never);
    await main.addNode(comp as never);
    const inner = new WeakRef(comp.internalEditor.getNodes()[0]);
    await main.removeNode(comp.id);
    comp = undefined;
    expect(await collected(inner)).toBe(true);
  });
});
