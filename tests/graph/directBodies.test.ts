// [[C130]] rustCore, [[graph-core#Direct calls]]
import { describe, expect, it, vi } from "vitest";
import { directBodies, offCoreBodies } from "../../src/graph/engineWasm/solenoid_graph.js";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { FilterNode, ListIndexNode } from "../../src/graph/nodes/list";
import { TemplateNode } from "../../src/graph/nodes/text";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import { ArithmeticNode, ValueInputNode } from "../../src/graph/nodeClasses";
import type { Schemes } from "../../src/graph/schemes";

/** `data()`'s body is `return nodeOnCore(this, inputs)` alone, as vitest's transform prints it. */
function bodyOnly(data: unknown): boolean {
  const src = String(data);
  const body = src.slice(src.indexOf(") {") + 3, src.lastIndexOf("}")).trim();
  return /^return \(0,\s*__vite_ssr_import_\d+__\.nodeOnCore\)\(this, inputs\);?$/.test(body);
}

const dataOf = (C: unknown) => (C as { prototype: { data?: unknown } }).prototype.data;

describe("direct cards", () => {
  it("are the classes whose data() is their body on the core, and the ones that only hand on what it can't hold", () => {
    const registry = ctorRegistry();
    const pure = [...registry].filter(([, C]) => bodyOnly(dataOf(C))).map(([name]) => name);
    const offCore = [...offCoreBodies()];
    for (const name of offCore) {
      const src = String(dataOf(registry.get(name)));
      expect(src, name).toMatch(/staysOffCore\)?\(raw\)/);
      expect(src, name).toMatch(/nodeOnCore\)\(this, inputs\)/);
    }
    expect([...directBodies()].sort()).toEqual([...pure, ...offCore].sort());
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

  it("read a lone surrogate in a label as U+FFFD rather than fail the card", async () => {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    const b = new ArithmeticNode({ op: "mul" });
    b.label = "half \ud800 pair";
    b.literals = { a: 6, b: 7 };
    await editor.addNode(b as unknown as Schemes["Node"]);
    expect((await engine.fetch(b.id)).result).toBe(42);
  });

  it("move their own sockets from what their body worked out (coreWatch)", async () => {
    const editor = new GraphEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    const table = new Src([[1, 2], [3, 4]]), list = new Src([5, 6, 7]);
    const filter = new FilterNode(), index = new ListIndexNode(), template = new TemplateNode();
    template.stringLiterals.template = "{a} and {b:0.0}";
    for (const n of [table, list, filter, index, template]) await editor.addNode(n as never);
    await editor.addConnection(new GraphConnection(table, "out", filter, "list") as never);
    await editor.addConnection(new GraphConnection(list, "out", index, "list") as never);
    const pass = async () => { await editor.engine!.pass(undefined, undefined, false); for (let i = 0; i < 4; i++) await Promise.resolve(); };
    await pass();
    expect(Object.keys(filter.inputs)).toContain("column");
    expect(index.indexAxes).toBe("position");
    expect(Object.keys(index.inputs)).toEqual(["list", "position"]);
    expect(template.sideVars).toEqual(["a", "b"]);
    expect(Object.keys(template.inputs)).toEqual(["template", "a", "b"]);
    template.stringLiterals.template = "{b}";
    template.edited();
    await pass();
    expect(Object.keys(template.inputs)).toEqual(["template", "b"]);
    editor.dispose();
  });
});

class Src extends GraphNode {
  constructor(public out: unknown) { super("src"); this.addOutput("out", new GraphOutput(new GraphSocket("trueany"))); }
  data() { return { out: this.out }; }
}
