// [[C130]] rustCore
// The editor handle over the graph core: the signals its pipes hear and their order, a pipe's veto and throw, the
// ports the core holds (tree/specs/computation/graph-core.md § The model).
import { describe, it, expect } from "vitest";
import { GraphEditor, type GraphSignal } from "../../src/graph/graphEditor";
import { GraphConnection, GraphInput, GraphNode, GraphOutput, GraphSocket, type GraphSchemes } from "../../src/graph/graphModel";
import { MutableSocket, AdoptiveSocket } from "../../src/graph/sockets";

class N extends GraphNode {
  constructor(inputs: string[] = [], outputs: string[] = ["out"]) {
    super("n");
    for (const k of inputs) this.addInput(k, new GraphInput(new GraphSocket("number"), k));
    for (const k of outputs) this.addOutput(k, new GraphOutput(new GraphSocket("number")));
  }
}

type S = GraphSchemes;

function logged(editor: GraphEditor<S>): string[] {
  const log: string[] = [];
  editor.addPipe((s: GraphSignal<S>) => {
    log.push("data" in s ? `${s.type}:${s.data.id}` : s.type);
    return s;
  });
  return log;
}

async function pair(editor: GraphEditor<S>) {
  const a = new N(), b = new N(["x"]);
  a.id = "a"; b.id = "b";
  await editor.addNode(a);
  await editor.addNode(b);
  const c = new GraphConnection(a, "out", b, "x");
  c.id = "c";
  await editor.addConnection(c);
  return { a, b, c };
}

describe("GraphEditor", () => {
  it("sends rete's signals in rete's order, clear removing cables before nodes", async () => {
    const editor = new GraphEditor<S>();
    const log = logged(editor);
    await pair(editor);
    await editor.clear();
    expect(log).toEqual([
      "nodecreate:a", "nodecreated:a", "nodecreate:b", "nodecreated:b",
      "connectioncreate:c", "connectioncreated:c",
      "clear",
      "connectionremove:c", "connectionremoved:c",
      "noderemove:a", "noderemoved:a", "noderemove:b", "noderemoved:b",
      "cleared",
    ]);
    expect(editor.getNodes()).toEqual([]);
    expect(editor.coreIds()).toEqual({ nodes: [], connections: [] });
  });

  it("answers getNode in a nodecreated pipe and not in a nodecreate one", async () => {
    const editor = new GraphEditor<S>();
    const seen: Record<string, boolean> = {};
    editor.addPipe((s) => {
      if (s.type === "nodecreate" || s.type === "nodecreated") seen[s.type] = editor.getNode(s.data.id) === s.data;
      return s;
    });
    await editor.addNode(new N());
    expect(seen).toEqual({ nodecreate: false, nodecreated: true });
  });

  it("cancels a change a pipe stops, and a cancelled clear signals clearcancelled", async () => {
    const editor = new GraphEditor<S>();
    const log = logged(editor);
    await pair(editor);
    log.length = 0;
    const veto = new Set(["noderemove", "connectioncreate", "clear"]);
    editor.addPipe((s) => (veto.has(s.type) ? undefined : s));
    expect(await editor.removeNode("a")).toBe(false);
    expect(await editor.clear()).toBe(false);
    const a = editor.getNode("a")!, b = editor.getNode("b")!;
    expect(await editor.addConnection(new GraphConnection(a, "out", b, "x"))).toBe(false);
    expect(log.filter((t) => !t.startsWith("connectioncreate"))).toEqual(["noderemove:a", "clear", "clearcancelled"]);
    expect(editor.getNodes().map((n) => n.id)).toEqual(["a", "b"]);
    expect(editor.coreIds()).toEqual({ nodes: ["a", "b"], connections: ["c"] });
  });

  it("rejects an edit with what a pipe threw, and the later pipes hear nothing", async () => {
    const editor = new GraphEditor<S>();
    const boom = new Error("boom");
    editor.addPipe((s) => { if (s.type === "nodecreate") throw boom; return s; });
    const later = logged(editor);
    await expect(editor.addNode(new N())).rejects.toBe(boom);
    expect(later).toEqual([]);
    expect(editor.getNodes()).toEqual([]);
  });

  it("stops calling a removed pipe; the others keep their places", async () => {
    const editor = new GraphEditor<S>();
    const first = logged(editor);
    const removed: string[] = [];
    const handle = editor.addPipe((s) => { removed.push(s.type); return s; });
    const last = logged(editor);
    await editor.addNode(new N());
    editor.removePipe(handle);
    await editor.addNode(new N());
    expect(removed).toEqual(["nodecreate", "nodecreated"]);
    expect(first.length).toBe(4);
    expect(last.length).toBe(4);
  });

  it("keeps rete's error messages", async () => {
    const editor = new GraphEditor<S>();
    const { a } = await pair(editor);
    await expect(editor.addNode(a)).rejects.toThrow("node has already been added");
    await expect(editor.removeNode("nope")).rejects.toThrow("cannot find node");
    await expect(editor.removeConnection("nope")).rejects.toThrow("cannot find connection");
    expect(() => new GraphConnection(a, "missing", a, "x")).toThrow("doesn't have output");
  });

  it("holds each node's ports in the core, in key order, through every port change", async () => {
    const editor = new GraphEditor<S>();
    const n = new N(["x", "y"], ["out"]);
    await editor.addNode(n);
    expect(editor.corePorts(n.id, false)).toEqual([["x", "number"], ["y", "number"]]);
    n.addInput("z", new GraphInput(new GraphSocket("text")));
    n.moveInputLast("x");
    n.removeInput("y");
    expect(editor.corePorts(n.id, false)).toEqual([["z", "text"], ["x", "number"]]);
    expect(Object.keys(n.inputs)).toEqual(["z", "x"]);

    const mutable = new MutableSocket("number");
    n.addOutput("m", new GraphOutput(mutable));
    mutable.setType("string");
    n.outputs.out!.socket = new GraphSocket("boolean");
    expect(editor.corePorts(n.id, true)).toEqual([["out", "boolean"], ["m", "string"]]);

    const adoptive = new AdoptiveSocket("trueany");
    n.addInput("t", new GraphInput(adoptive));
    adoptive.setType("number");
    expect(editor.corePorts(n.id, false)?.slice(-1)).toEqual([["t", "trueany"]]);

    await editor.removeNode(n.id);
    n.addInput("after", new GraphInput(new GraphSocket("text")));
    expect(editor.corePorts(n.id, false)).toBeUndefined();
  });

  it("hands out a fresh copy of each list, in the core's order", async () => {
    const editor = new GraphEditor<S>();
    const { a, b, c } = await pair(editor);
    const list = editor.getNodes();
    list.pop();
    expect(editor.getNodes()).toEqual([a, b]);
    expect(editor.getConnections()).toEqual([c]);
    expect(editor.getConnection("c")).toBe(c);
    expect(editor.coreIds().nodes).toEqual(editor.getNodes().map((n) => n.id));
  });
});
