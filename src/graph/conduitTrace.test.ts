import { describe, it, expect } from "vitest";
import { ClassicPreset } from "rete";
import { resolveTypedSource } from "./conduitTrace";
import { ConduitNode, conduitInKey, conduitOutKey } from "./nodes/conduit";
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
