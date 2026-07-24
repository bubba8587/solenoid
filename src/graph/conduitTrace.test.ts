import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { resolveTypedSource, reconcileConduitTypes, conduitPath, type PathConn } from "./conduitTrace";
import { ConduitNode, conduitInKey, conduitOutKey } from "./nodes/conduit";
import type { Schemes } from "./schemes";
import { dateSocket, numberSocket } from "./sockets";

// A tiny fake editor: just getNode + getConnections, the surface resolveTypedSource
// reads. Real ConduitNode instances so the `instanceof` gate fires.
function makeEditor(nodes: Record<string, ClassicPreset.Node>, conns: Array<{ source: string; sourceOutput: string; target: string; targetInput: string }>) {
  return {
    getNode: (id: string) => nodes[id],
    getConnections: () => conns,
  };
}

describe("resolveTypedSource — Conduit type tracing", () => {
  it("a direct (non-conduit) source returns its own socket", () => {
    const src = new ClassicPreset.Node("Src");
    src.addOutput("result", new ClassicPreset.Output(dateSocket));
    const ed = makeEditor({ [src.id]: src }, []);
    const r = resolveTypedSource(ed, src.id, "result");
    expect(r.socket).toBe(dateSocket);
    expect(r.source).toBe(src.id);
    expect(r.sourceOutput).toBe("result");
  });

  it("traces a Conduit output lane back to the feeding source's socket (date stays date)", () => {
    const dateSrc = new ClassicPreset.Node("Date");
    dateSrc.addOutput("result", new ClassicPreset.Output(dateSocket));
    const cond = new ConduitNode({});
    const ed = makeEditor(
      { [dateSrc.id]: dateSrc, [cond.id]: cond },
      [{ source: dateSrc.id, sourceOutput: "result", target: cond.id, targetInput: conduitInKey(2) }],
    );
    // The cable leaving the conduit on lane 2 must resolve to the DATE socket,
    // not the conduit's own `any` lane socket.
    const r = resolveTypedSource(ed, cond.id, conduitOutKey(2));
    expect(r.socket).toBe(dateSocket);
    expect(r.source).toBe(dateSrc.id);
    expect(r.sourceOutput).toBe("result");
  });

  it("traces through CHAINED conduits", () => {
    const numSrc = new ClassicPreset.Node("Num");
    numSrc.addOutput("value", new ClassicPreset.Output(numberSocket));
    const c1 = new ConduitNode({});
    const c2 = new ConduitNode({});
    const ed = makeEditor(
      { [numSrc.id]: numSrc, [c1.id]: c1, [c2.id]: c2 },
      [
        { source: numSrc.id, sourceOutput: "value", target: c1.id, targetInput: conduitInKey(0) },
        { source: c1.id, sourceOutput: conduitOutKey(0), target: c2.id, targetInput: conduitInKey(1) },
      ],
    );
    const r = resolveTypedSource(ed, c2.id, conduitOutKey(1));
    expect(r.socket).toBe(numberSocket);
    expect(r.source).toBe(numSrc.id);
  });

  it("an unwired conduit lane returns the conduit's own (any) socket", () => {
    const cond = new ConduitNode({});
    const ed = makeEditor({ [cond.id]: cond }, []);
    const r = resolveTypedSource(ed, cond.id, conduitOutKey(0));
    // No feed → falls back to the conduit's own output socket, source = conduit.
    expect(r.source).toBe(cond.id);
    expect(r.sourceOutput).toBe(conduitOutKey(0));
  });
});

describe("conduitPath — the whole run a cable belongs to", () => {
  // Same fake editor, but connections carry ids (conduitPath returns id lists).
  function pathEditor(nodes: Record<string, ClassicPreset.Node>, conns: PathConn[]) {
    return { getNode: (id: string) => nodes[id], getConnections: () => conns };
  }
  const plainNode = (name: string) => {
    const n = new ClassicPreset.Node(name);
    n.addOutput("out", new ClassicPreset.Output(numberSocket));
    n.addInput("in", new ClassicPreset.Input(numberSocket));
    return n;
  };

  it("a cable with no Conduit on either side is its own run", () => {
    const a = plainNode("A"), b = plainNode("B");
    const c: PathConn = { id: "c1", source: a.id, sourceOutput: "out", target: b.id, targetInput: "in" };
    const ed = pathEditor({ [a.id]: a, [b.id]: b }, [c]);
    const p = conduitPath(ed, c);
    expect(p.connIds).toEqual(["c1"]);
    expect(p.conduits).toEqual([]);
    expect(p.origin).toEqual({ nodeId: a.id, key: "out" });
    expect(p.terminals).toEqual([{ nodeId: b.id, key: "in" }]);
  });

  it("resolves both ends through a Conduit, from EITHER segment", () => {
    const a = plainNode("A"), b = plainNode("B");
    const cond = new ConduitNode({});
    const inSeg: PathConn = { id: "c1", source: a.id, sourceOutput: "out", target: cond.id, targetInput: conduitInKey(3) };
    const outSeg: PathConn = { id: "c2", source: cond.id, sourceOutput: conduitOutKey(3), target: b.id, targetInput: "in" };
    const ed = pathEditor({ [a.id]: a, [b.id]: b, [cond.id]: cond }, [inSeg, outSeg]);

    for (const seg of [inSeg, outSeg]) {
      const p = conduitPath(ed, seg);
      expect(p.connIds).toEqual(["c1", "c2"]);
      expect(p.conduits).toEqual([cond.id]);
      expect(p.origin).toEqual({ nodeId: a.id, key: "out" });
      expect(p.terminals).toEqual([{ nodeId: b.id, key: "in" }]);
    }
  });

  it("threads a run through CHAINED conduits, upstream-first", () => {
    const a = plainNode("A"), b = plainNode("B");
    const c1 = new ConduitNode({}), c2 = new ConduitNode({});
    const conns: PathConn[] = [
      { id: "s1", source: a.id, sourceOutput: "out", target: c1.id, targetInput: conduitInKey(0) },
      { id: "s2", source: c1.id, sourceOutput: conduitOutKey(0), target: c2.id, targetInput: conduitInKey(1) },
      { id: "s3", source: c2.id, sourceOutput: conduitOutKey(1), target: b.id, targetInput: "in" },
    ];
    const ed = pathEditor({ [a.id]: a, [b.id]: b, [c1.id]: c1, [c2.id]: c2 }, conns);
    const p = conduitPath(ed, conns[1]);
    expect(p.connIds).toEqual(["s1", "s2", "s3"]);
    expect(p.conduits).toEqual([c1.id, c2.id]);
    expect(p.origin).toEqual({ nodeId: a.id, key: "out" });
    expect(p.terminals).toEqual([{ nodeId: b.id, key: "in" }]);
  });

  it("fans out downstream — one lane feeding several inputs yields several terminals", () => {
    const a = plainNode("A"), b = plainNode("B"), c = plainNode("C");
    const cond = new ConduitNode({});
    const conns: PathConn[] = [
      { id: "s1", source: a.id, sourceOutput: "out", target: cond.id, targetInput: conduitInKey(0) },
      { id: "s2", source: cond.id, sourceOutput: conduitOutKey(0), target: b.id, targetInput: "in" },
      { id: "s3", source: cond.id, sourceOutput: conduitOutKey(0), target: c.id, targetInput: "in" },
    ];
    const ed = pathEditor({ [a.id]: a, [b.id]: b, [c.id]: c, [cond.id]: cond }, conns);
    // EVERY segment must resolve to the SAME run, including a branch cable —
    // the inspector's "is this selection one run?" check depends on it, and
    // double-clicking one branch must light its siblings too.
    for (const seg of conns) {
      const p = conduitPath(ed, seg);
      expect(p.connIds).toEqual(["s1", "s2", "s3"]);
      expect(p.origin).toEqual({ nodeId: a.id, key: "out" });
      expect(p.terminals).toEqual([{ nodeId: b.id, key: "in" }, { nodeId: c.id, key: "in" }]);
    }
  });

  it("a lane that dead-ends stays on the Conduit at that end", () => {
    const b = plainNode("B");
    const cond = new ConduitNode({});
    // Nothing feeds lane 2, and lane 5 leaves for nobody.
    const out: PathConn = { id: "s1", source: cond.id, sourceOutput: conduitOutKey(2), target: b.id, targetInput: "in" };
    const into: PathConn = { id: "s2", source: b.id, sourceOutput: "out", target: cond.id, targetInput: conduitInKey(5) };
    const ed = pathEditor({ [b.id]: b, [cond.id]: cond }, [out, into]);

    const up = conduitPath(ed, out);
    expect(up.origin).toEqual({ nodeId: cond.id, key: conduitOutKey(2) });
    expect(up.conduits).toEqual([]);

    const down = conduitPath(ed, into);
    expect(down.terminals).toEqual([{ nodeId: cond.id, key: conduitInKey(5) }]);
    expect(down.conduits).toEqual([]);
  });

  it("terminates on a Conduit loop instead of walking forever", () => {
    const c1 = new ConduitNode({}), c2 = new ConduitNode({});
    const conns: PathConn[] = [
      { id: "l1", source: c1.id, sourceOutput: conduitOutKey(0), target: c2.id, targetInput: conduitInKey(0) },
      { id: "l2", source: c2.id, sourceOutput: conduitOutKey(0), target: c1.id, targetInput: conduitInKey(0) },
    ];
    const ed = pathEditor({ [c1.id]: c1, [c2.id]: c2 }, conns);
    const p = conduitPath(ed, conns[0]);
    expect(p.connIds.sort()).toEqual(["l1", "l2"]);
  });
});

describe("reconcileConduitTypes — lanes adopt the wired-in type", () => {
  async function build() {
    const editor = new NodeEditor<Schemes>();
    const dateSrc = new ClassicPreset.Node("Date") as unknown as Schemes["Node"];
    dateSrc.addOutput("result", new ClassicPreset.Output(dateSocket));
    const numSrc = new ClassicPreset.Node("Num") as unknown as Schemes["Node"];
    numSrc.addOutput("value", new ClassicPreset.Output(numberSocket));
    const cond = new ConduitNode({}) as unknown as Schemes["Node"];
    for (const n of [dateSrc, numSrc, cond]) await editor.addNode(n);
    return { editor, dateSrc, numSrc, cond };
  }

  it("out lane adopts date / number; an unwired lane stays any", async () => {
    const { editor, dateSrc, numSrc, cond } = await build();
    await editor.addConnection(new ClassicPreset.Connection(dateSrc, "result", cond, conduitInKey(2)) as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(numSrc, "value", cond, conduitInKey(0)) as Schemes["Connection"]);

    const changed = reconcileConduitTypes(editor);
    expect(changed).toBe(true);
    const dt = (k: string) => (cond.outputs[k]?.socket as { dataType?: string })?.dataType;
    expect(dt(conduitOutKey(2))).toBe("date");   // adopted from the date source
    expect(dt(conduitOutKey(0))).toBe("number");  // adopted from the number source
    expect(dt(conduitOutKey(1))).toBe("trueany"); // unwired lane stays the wildcard
  });

  it("reverts a lane to any when its feed is removed", async () => {
    const { editor, dateSrc, cond } = await build();
    const conn = new ClassicPreset.Connection(dateSrc, "result", cond, conduitInKey(0)) as Schemes["Connection"];
    await editor.addConnection(conn);
    reconcileConduitTypes(editor);
    expect((cond.outputs[conduitOutKey(0)]?.socket as { dataType?: string })?.dataType).toBe("date");

    await editor.removeConnection(conn.id);
    reconcileConduitTypes(editor);
    expect((cond.outputs[conduitOutKey(0)]?.socket as { dataType?: string })?.dataType).toBe("trueany");
  });
});
