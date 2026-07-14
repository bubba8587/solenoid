import { describe, it, expect } from "vitest";
import { ClassicPreset } from "rete";
import { reconcileTrueAnyTypes, type AdoptEditor } from "./trueAnyAdopt";
import { DisplayNode } from "./nodes/display";
import { IfNode } from "./nodes/logic";
import { CableSwitchNode } from "./nodes/control";
import { ListIndexNode, ReverseNode } from "./rete-nodes";
import { numberSocket, stringSocket, frameSocket, dateListSocket, SolenoidSocket } from "./sockets";

// Same fake-editor surface as conduitTrace.test.ts — the pass only reads
// getNodes/getNode/getConnections and mutates sockets in place.
type Conn = { source: string; sourceOutput: string; target: string; targetInput: string };
function makeEditor(nodes: ClassicPreset.Node[], conns: Conn[]): AdoptEditor {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return {
    getNodes: () => nodes as never[],
    getNode: (id: string) => byId[id] as never,
    getConnections: () => conns,
  };
}

const dt = (sock: ClassicPreset.Socket | undefined) =>
  sock instanceof SolenoidSocket ? sock.dataType : undefined;

function numSource(): ClassicPreset.Node {
  const n = new ClassicPreset.Node("Num");
  n.addOutput("value", new ClassicPreset.Output(numberSocket));
  return n;
}
function strSource(): ClassicPreset.Node {
  const n = new ClassicPreset.Node("Text");
  n.addOutput("value", new ClassicPreset.Output(stringSocket));
  return n;
}

describe("trueany adoption — placeholder sockets take the wired cable's type (D17)", () => {
  it("a Display adopts on both sides and REVERTS on disconnect", () => {
    const src = numSource();
    const disp = new DisplayNode();
    const wire: Conn = { source: src.id, sourceOutput: "value", target: disp.id, targetInput: "in" };
    const ed = makeEditor([src, disp], [wire]);
    reconcileTrueAnyTypes(ed);
    expect(dt(disp.inputs.in?.socket)).toBe("number");
    expect(dt(disp.outputs.out?.socket)).toBe("number"); // passthrough adopts through
    // Disconnect → both revert to the hollow placeholder.
    reconcileTrueAnyTypes(makeEditor([src, disp], []));
    expect(dt(disp.inputs.in?.socket)).toBe("trueany");
    expect(dt(disp.outputs.out?.socket)).toBe("trueany");
  });

  it("adoption propagates down a passthrough CHAIN (Display → Display)", () => {
    const src = strSource();
    const d1 = new DisplayNode();
    const d2 = new DisplayNode();
    const ed = makeEditor([src, d1, d2], [
      { source: src.id, sourceOutput: "value", target: d1.id, targetInput: "in" },
      { source: d1.id, sourceOutput: "out", target: d2.id, targetInput: "in" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(d2.inputs.in?.socket)).toBe("string");
    expect(dt(d2.outputs.out?.socket)).toBe("string");
  });

  it("two Displays do NOT share adoption (per-instance sockets)", () => {
    const num = numSource();
    const str = strSource();
    const dNum = new DisplayNode();
    const dStr = new DisplayNode();
    const ed = makeEditor([num, str, dNum, dStr], [
      { source: num.id, sourceOutput: "value", target: dNum.id, targetInput: "in" },
      { source: str.id, sourceOutput: "value", target: dStr.id, targetInput: "in" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(dNum.inputs.in?.socket)).toBe("number");
    expect(dt(dStr.inputs.in?.socket)).toBe("string");
  });

  it("IF's result adopts when the wired branches AGREE, stays hollow when they disagree", () => {
    const num = numSource();
    const str = strSource();
    const agreeing = new IfNode();
    let ed = makeEditor([num, agreeing], [
      { source: num.id, sourceOutput: "value", target: agreeing.id, targetInput: "then" },
      { source: num.id, sourceOutput: "value", target: agreeing.id, targetInput: "else" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(agreeing.outputs.result?.socket)).toBe("number");

    const mixed = new IfNode();
    ed = makeEditor([num, str, mixed], [
      { source: num.id, sourceOutput: "value", target: mixed.id, targetInput: "then" },
      { source: str.id, sourceOutput: "value", target: mixed.id, targetInput: "else" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(mixed.inputs.then?.socket)).toBe("number"); // inputs adopt individually
    expect(dt(mixed.inputs.else?.socket)).toBe("string");
    expect(dt(mixed.outputs.result?.socket)).toBe("trueany"); // result genuinely runtime-dependent
  });

  it("a single wired IF branch is enough to adopt the result", () => {
    const num = numSource();
    const n = new IfNode();
    const ed = makeEditor([num, n], [
      { source: num.id, sourceOutput: "value", target: n.id, targetInput: "then" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(n.outputs.result?.socket)).toBe("number");
  });

  it("Input Switch (One mode) adopts the ACTIVE slot's type", () => {
    const num = numSource();
    const str = strSource();
    const sw = new CableSwitchNode();
    const [k0, k1] = Object.keys(sw.inputs);
    const conns: Conn[] = [
      { source: num.id, sourceOutput: "value", target: sw.id, targetInput: k0 },
      { source: str.id, sourceOutput: "value", target: sw.id, targetInput: k1 },
    ];
    sw.activeIndex = 0;
    reconcileTrueAnyTypes(makeEditor([num, str, sw], conns));
    expect(dt(sw.outputs.out?.socket)).toBe("number");
    sw.activeIndex = 1;
    reconcileTrueAnyTypes(makeEditor([num, str, sw], conns));
    expect(dt(sw.outputs.out?.socket)).toBe("string");
  });

  it("an element-preserving op (Reverse) FORWARDS its input's type through to its output", () => {
    const src = new ClassicPreset.Node("Dates");
    src.addOutput("out", new ClassicPreset.Output(dateListSocket));
    const rev = new ReverseNode();
    const ed = makeEditor([src, rev], [
      { source: src.id, sourceOutput: "out", target: rev.id, targetInput: "list" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(rev.inputs.list?.socket)).toBe("datelist");   // input adopts
    expect(dt(rev.outputs.result?.socket)).toBe("datelist"); // output forwards it (was neutral `anylist`)
    // Reverts to the neutral base when unwired (both dots gray again).
    reconcileTrueAnyTypes(makeEditor([src, rev], []));
    expect(dt(rev.outputs.result?.socket)).toBe("anylist");
  });

  it("INDEX: the Array input adopts, the result stays the STATIC wildcard", () => {
    const src = new ClassicPreset.Node("Frame");
    src.addOutput("frame", new ClassicPreset.Output(frameSocket));
    const idx = new ListIndexNode();
    const ed = makeEditor([src, idx], [
      { source: src.id, sourceOutput: "frame", target: idx.id, targetInput: "list" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.inputs.list?.socket)).toBe("frame");
    expect(dt(idx.outputs.result?.socket)).toBe("trueany"); // a cube cell's type varies per row
  });
});
