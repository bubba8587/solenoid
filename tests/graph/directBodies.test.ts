// [[D102]] graphOnCore
// The cards the engine calls in Rust (graph-core.md § Direct calls) are exactly the classes whose `data()` is their
// body on the core and nothing else, and such a card in an editor computes with no call to its `data()`.
import { describe, expect, it, vi } from "vitest";
import { directBodies } from "../../src/graph/engineWasm/solenoid_graph.js";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import { ArithmeticNode, ValueInputNode } from "../../src/graph/nodeClasses";
import type { Schemes } from "../../src/graph/schemes";

/** `data()`'s body is `return nodeOnCore(this, inputs)` alone, as vitest's transform prints it. */
function bodyOnly(data: unknown): boolean {
  const src = String(data);
  const body = src.slice(src.indexOf(") {") + 3, src.lastIndexOf("}")).trim();
  return /^return \(0,\s*__vite_ssr_import_\d+__\.nodeOnCore\)\(this, inputs\);?$/.test(body);
}

describe("direct cards", () => {
  it("are the classes whose data() is their body on the core", () => {
    const pure = [...ctorRegistry()]
      .filter(([, C]) => bodyOnly((C as unknown as { prototype: { data?: unknown } }).prototype.data))
      .map(([name]) => name)
      .sort();
    expect([...directBodies()].sort()).toEqual(pure);
  });

  it("compute in an editor without their data() being called", async () => {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    const a = new ValueInputNode({ value: "2" });
    const b = new ArithmeticNode({ op: "mul" });
    b.literals = { b: 21 };
    await editor.addNode(a as unknown as Schemes["Node"]);
    await editor.addNode(b as unknown as Schemes["Node"]);
    await editor.addConnection(new GraphConnection(a, Object.keys(a.outputs)[0], b, "a") as unknown as Schemes["Connection"]);
    const data = vi.spyOn(ArithmeticNode.prototype, "data");
    try {
      expect((await engine.fetch(b.id)).result).toBe(42);
      expect(data).not.toHaveBeenCalled();
    } finally {
      data.mockRestore();
    }
  });
});
