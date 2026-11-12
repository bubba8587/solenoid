// [[C130]] rustCore, [[engineering#Performance]], [[node-bodies#The call]]
import { describe, it, expect } from "vitest";
import { nodeOnCore } from "../../src/graph/nodeOnCore";
import { heldId } from "../../src/graph/heldValues";
import { wasmCardKeptCount, wasmCardForget } from "../../src/graph/engineWasm";
import { withMatrixUnit } from "../../src/graph/unitValue";
import { TextTransformNode, TextLenNode } from "../../src/graph/nodes/text";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphInput, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";

const words = (n: number, tag = "w") => Array.from({ length: n }, (_, i) => `${tag}${i}`);

class Src extends GraphNode {
  constructor(public out: unknown) { super("src"); this.addOutput("out", new GraphOutput(new GraphSocket("string"))); }
  data() { return { out: this.out }; }
}
class Sink extends GraphNode {
  got: unknown;
  constructor() { super("sink"); this.addInput("x", new GraphInput(new GraphSocket("any"), "x")); }
  data(i: { x?: unknown[] }) { this.got = i.x?.[0]; return {}; }
}

describe("a big value the core keeps", () => {
  it("crosses into a card once, then as its id", () => {
    const list = words(500);
    const upper = new TextTransformNode({ op: "upper" });
    const first = nodeOnCore(upper, { text: [list] }).result as string[];
    const id = heldId(list);
    expect(id).toBeTypeOf("number");
    const kept = wasmCardKeptCount();
    const again = nodeOnCore(upper, { text: [list] }).result as string[];
    expect(wasmCardKeptCount()).toBe(kept + 1); // the new answer only; the input went as its id
    expect(heldId(list)).toBe(id);
    expect(again).toEqual(first);
    expect(first[499]).toBe("W499");
  });

  it("comes back from a card kept, and goes on to the next as its id", () => {
    const upper = nodeOnCore(new TextTransformNode({ op: "upper" }), { text: [words(300)] }).result as string[];
    expect(heldId(upper)).toBeTypeOf("number");
    const kept = wasmCardKeptCount();
    const lens = nodeOnCore(new TextLenNode(), { text: [upper] }).result as number[];
    expect(wasmCardKeptCount()).toBe(kept + 1);
    expect(lens.slice(0, 3)).toEqual([2, 2, 2]);
  });

  it("goes whole again once it takes a table's unit, which the core's copy doesn't carry", () => {
    const list = words(200, "u");
    nodeOnCore(new TextLenNode(), { text: [list] });
    const id = heldId(list)!;
    withMatrixUnit(list, { dim: { length: 1 }, display: "m" } as never);
    const kept = wasmCardKeptCount();
    nodeOnCore(new TextLenNode(), { text: [list] });
    expect(wasmCardKeptCount()).toBeGreaterThan(kept);
    expect(heldId(list)).toBe(id);
  });

  it("answers an error, not a wrong value, where the core lost it", () => {
    const list = words(200, "x");
    nodeOnCore(new TextLenNode(), { text: [list] });
    wasmCardForget(Uint32Array.of(heldId(list)!));
    const r = nodeOnCore(new TextLenNode(), { text: [list] }).result as { code?: string; message?: string };
    expect(r.code).toBe("#ERROR!");
    expect(r.message).toMatch(/lost a value/);
  });

  it("crosses from a JavaScript card to a direct one once across passes", async () => {
    const list = words(400, "p");
    const editor = new GraphEditor<Schemes>();
    editor.use(new DataflowEngine<Schemes>());
    const src = new Src(list), upper = new TextTransformNode({ op: "upper" }), sink = new Sink();
    for (const n of [src, upper, sink]) await editor.addNode(n as never);
    await editor.addConnection(new GraphConnection(src, "out", upper, "text") as never);
    await editor.addConnection(new GraphConnection(upper, "result", sink, "x") as never);
    await editor.engine!.pass(undefined, undefined, false);
    expect(heldId(list)).toBeTypeOf("number");
    const first = sink.got as string[];
    expect(heldId(first)).toBeTypeOf("number");
    const kept = wasmCardKeptCount();
    await editor.engine!.pass(undefined, undefined, false);
    // The source's list went as its id; only the new answer was kept.
    expect(wasmCardKeptCount()).toBe(kept + 1);
    expect(sink.got).toEqual(first);
    expect(first[399]).toBe("P399");
    editor.dispose();
  });
});
