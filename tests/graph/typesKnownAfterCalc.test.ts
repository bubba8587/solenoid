// [[C136]] typesKnownAfterCalc
import { describe, it, expect, afterEach } from "vitest";
import { solDate } from "../../src/graph/dateValue";
import type { View } from "../../src/graph/view";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, type GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { processGraph, setEditorRefs } from "../../src/graph/process";
import { dateSocket, numberSocket, stringSocket, frameSocket } from "../../src/graph/sockets";
import { nodeOutputElemFamily } from "../../src/graph/components/valueDisplayFormat";
import { IfNode, IFErrorNode } from "../../src/graph/nodes/logic";
import { XLookupNode } from "../../src/graph/nodes/frame";
import { ListIndexNode } from "../../src/graph/nodes/list";
import { DisplayNode } from "../../src/graph/nodes/display";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { ValueInputNode } from "../../src/graph/nodes/control";
import type { FrameValue } from "../../src/graph/frame";

// Before a calculation the wiring can't tell these outputs' types; once it has run, nothing is unknown, and the
// Type Settle types each output by what it carried, so a date never leaves as its serial.

class Src extends GraphNode {
  constructor(private value: unknown, socket: GraphSocket) {
    super("Src");
    this.addOutput("out", new GraphOutput(socket));
  }
  set(v: unknown) { this.value = v; }
  data() { return { out: this.value }; }
}

const people: FrameValue = {
  __frame: true,
  columns: [
    { name: "name", type: "string", values: ["Ada", "Grace"] },
    { name: "born", type: "date", values: [46037, 46083] },
    { name: "age", type: "number", values: [36, 85] },
  ],
};

async function graph() {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const view = { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View;
  setEditorRefs(editor, engine, view);
  const add = async <N extends GraphNode>(n: N) => { await editor.addNode(n as unknown as Schemes["Node"]); return n; };
  const wire = (a: GraphNode, out: string, b: GraphNode, inp: string) =>
    editor.addConnection(new GraphConnection(a, out, b, inp) as unknown as Schemes["Connection"]);
  return { add, wire };
}

describe("[[C136]] once a calculation has run, an output's type is the type of what it carried", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  it("XLOOKUP whose Return column comes on a cable types its output by the column the run picked", async () => {
    const { add, wire } = await graph();
    const frame = await add(new Src(people, frameSocket));
    const ret = await add(new Src("born", stringSocket));
    const x = await add(new XLookupNode());
    x.stringLiterals = { lookup: "Grace", inColumn: "name", returnColumn: "", ifNotFound: "" };
    const disp = await add(new DisplayNode());
    await wire(frame, "out", x, "frame");
    await wire(ret, "out", x, "returnColumn");
    await wire(x, "value", disp, "in");
    expect(nodeOutputElemFamily(x.id)).toBeUndefined(); // the wiring alone can't tell
    await processGraph();
    expect(nodeOutputElemFamily(x.id)).toBe("date");
    expect(nodeOutputElemFamily(disp.id)).toBe("date"); // and it travels on
    ret.set("age");
    await processGraph();
    expect(nodeOutputElemFamily(x.id)).toBe("number"); // the type follows the data
  });

  it("XLOOKUP across the names types its output by the matched column", async () => {
    const { add, wire } = await graph();
    const frame = await add(new Src(people, frameSocket));
    const look = await add(new Src("born", stringSocket));
    const x = await add(new XLookupNode({ direction: "columns" }));
    x.stringLiterals = { lookup: "", ifNotFound: "" };
    x.literals = { returnRow: 1 };
    await wire(frame, "out", x, "frame");
    await wire(look, "out", x, "lookup");
    await processGraph();
    expect(nodeOutputElemFamily(x.id)).toBe("date");
  });

  it("INDEX with its Column on a cable types its output by the column it read", async () => {
    const { add, wire } = await graph();
    const frame = await add(new Src(people, frameSocket));
    const col = await add(new Src(2, numberSocket));
    const ix = await add(new ListIndexNode());
    ix.literals = { index: 1 };
    await wire(frame, "out", ix, "list");
    await wire(col, "out", ix, "column");
    await processGraph();
    expect(nodeOutputElemFamily(ix.id)).toBe("date");
  });

  it("IF with a date branch and a number branch shows the branch it took", async () => {
    const { add, wire } = await graph();
    const d = await add(new Src(solDate(46037), dateSocket));
    const n = await add(new Src(7, numberSocket));
    const iff = await add(new IfNode());
    iff.literals = { cond: 1 };
    await wire(d, "out", iff, "then");
    await wire(n, "out", iff, "else");
    expect(nodeOutputElemFamily(iff.id)).toBeUndefined(); // before the run, they disagree
    await processGraph();
    expect(nodeOutputElemFamily(iff.id)).toBe("date");
    iff.literals = { cond: 0 };
    await processGraph();
    expect(nodeOutputElemFamily(iff.id)).toBe("number"); // never a number shown as a date
  });

  it("a card the Type Settle retypes after the pass is drawn again with its new type", async () => {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    const drawn: [string, string][] = [];
    const typeOf = (n: GraphNode) => (n.outputs.result!.socket as unknown as { dataType: string }).dataType;
    const iff = new IfNode();
    const view = { rerenderNode: async (id: string) => { if (id === iff.id) drawn.push([id, typeOf(iff)]); }, rerenderCables: async () => {} } as unknown as View;
    setEditorRefs(editor, engine, view);
    const d = new Src(solDate(46037), dateSocket);
    const n = new Src(7, numberSocket);
    for (const x of [d, n, iff]) await editor.addNode(x as unknown as Schemes["Node"]);
    iff.literals = { cond: 1 };
    await editor.addConnection(new GraphConnection(d, "out", iff, "then") as unknown as Schemes["Connection"]);
    await editor.addConnection(new GraphConnection(n, "out", iff, "else") as unknown as Schemes["Connection"]);
    await processGraph();
    expect(drawn[drawn.length - 1]?.[1]).toBe(typeOf(iff));
    iff.literals = { cond: 0 };
    iff.edited();
    await processGraph();
    expect(nodeOutputElemFamily(iff.id)).toBe("number");
    expect(drawn[drawn.length - 1]?.[1]).toBe(typeOf(iff)); // the last draw saw the number type, not the date it had
  });

  it("a card inside a composite takes the type of what it carried too", async () => {
    const outer = new CompositeNode({ label: "Outer" });
    const inner = outer.internalEditor;
    const d = new ValueInputNode({ op: "date", value: "05-Jan-2026" });
    const n = new ValueInputNode({ op: "number", value: "7" });
    const iff = new IfNode();
    iff.literals = { cond: 1 };
    for (const x of [d, n, iff]) await inner.addNode(x as unknown as Schemes["Node"]);
    await inner.addConnection(new GraphConnection(d, "value", iff, "then") as unknown as Schemes["Connection"]);
    await inner.addConnection(new GraphConnection(n, "value", iff, "else") as unknown as Schemes["Connection"]);
    const typeOf = () => (iff.outputs.result!.socket as unknown as { dataType: string }).dataType;
    await outer.data({});
    await Promise.resolve();
    expect(typeOf()).toBe("datecombo");
    iff.literals = { cond: 0 };
    outer.markInternalEdit();
    await outer.data({});
    await Promise.resolve();
    expect(typeOf()).toBe("numlist");
  });

  it("IFERROR shows the value's type when nothing was caught", async () => {
    const { add, wire } = await graph();
    const d = await add(new Src(solDate(46037), dateSocket));
    const f = await add(new Src("none", stringSocket));
    const ie = await add(new IFErrorNode());
    await wire(d, "out", ie, "value");
    await wire(f, "out", ie, "fallback");
    await processGraph();
    expect(nodeOutputElemFamily(ie.id)).toBe("date");
  });
});
