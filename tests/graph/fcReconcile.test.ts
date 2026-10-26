// [[B11]]
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphInput, GraphNode, GraphOutput } from "../../src/graph/graphModel";
import { retypeOutputCables, retypeInputCables, reconcileFcs } from "../../src/graph/fcReconcile";
import { stringSocket, anySocket, numberSocket, dateTableSocket, SolenoidSocket, AdoptiveSocket } from "../../src/graph/sockets";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;
// reconcileFcTypes only calls area.update for FC/Convert nodes (none here), so a
// no-op stub suffices to exercise retypeOutputCables' cable-keep logic.
const stubArea = { update: async () => {}, rerenderNode: async () => {}, rerenderCables: () => {} } as never;

describe("retypeOutputCables (Cast / LAMBDA / Get Column shared retype path)", () => {
  it("keeps a cable to an `any` input but drops a now-incompatible typed one", async () => {
    const editor = new GraphEditor() as unknown as AnyEditor;
    const src = new GraphNode("Src");
    src.addOutput("result", new GraphOutput(stringSocket, "Result")); // post-swap type = string
    const consAny = new GraphNode("Any");
    consAny.addInput("in", new GraphInput(anySocket, "In"));
    const consNum = new GraphNode("Num");
    consNum.addInput("in", new GraphInput(numberSocket, "In"));
    for (const n of [src, consAny, consNum]) await editor.addNode(n as never);
    const toAny = new GraphConnection(src as never, "result", consAny as never, "in");
    const toNum = new GraphConnection(src as never, "result", consNum as never, "in");
    await editor.addConnection(toAny as never);
    await editor.addConnection(toNum as never);

    await retypeOutputCables(editor as never, stubArea, src.id, "result");

    const ids = editor.getConnections().map((c) => c.id);
    expect(ids).toContain(toAny.id);   // string → any: kept
    expect(ids).not.toContain(toNum.id); // string → number: dropped (incompatible)
  });
});

describe("retypeInputCables (Add Column's Add as)", () => {
  it("keeps a cable the new input type still accepts and drops one it refuses", async () => {
    const editor = new GraphEditor() as unknown as AnyEditor;
    const str = new GraphNode("Str");
    str.addOutput("out", new GraphOutput(stringSocket, "Out"));
    const num = new GraphNode("Num");
    num.addOutput("out", new GraphOutput(numberSocket, "Out"));
    const cons = new GraphNode("Cons");
    cons.addInput("a", new GraphInput(numberSocket, "A")); // post-swap type = number
    cons.addInput("b", new GraphInput(numberSocket, "B"));
    for (const n of [str, num, cons]) await editor.addNode(n as never);
    const fromStr = new GraphConnection(str as never, "out", cons as never, "a");
    const fromNum = new GraphConnection(num as never, "out", cons as never, "b");
    await editor.addConnection(fromStr as never);
    await editor.addConnection(fromNum as never);

    await retypeInputCables(editor as never, stubArea, cons.id, "a");
    await retypeInputCables(editor as never, stubArea, cons.id, "b");

    const ids = editor.getConnections().map((c) => c.id);
    expect(ids).not.toContain(fromStr.id);
    expect(ids).toContain(fromNum.id);
  });
});

// ─── Family resolution treats EVERY family-less rung alike (isWildcardRung) ───
// An FC resolves the family it should offer controls for from whatever socket it
// can see. A rank-bearing wildcard (`anydata` on an Expression variable,
// `anylist`, `anytable`) carries a RANK but no FAMILY — adopting it as the
// answer left the FC with familyOf() === "none" and therefore NO controls at
// all, while the same FC wired into a `trueany` input showed the provisional
// number set. Same intent, two answers, decided by which family-less rung the
// consumer happened to declare (2026-08-01).
describe("FC family resolution ignores every family-less wildcard rung", () => {
  const fcInto = async (consumerSocket: SolenoidSocket) => {
    const editor = new GraphEditor() as unknown as AnyEditor;
    const fc = new FormatControllerNode({});
    const cons = new GraphNode("Consumer");
    cons.addInput("in", new GraphInput(consumerSocket, "In"));
    for (const n of [fc, cons]) await editor.addNode(n as never);
    await editor.addConnection(
      new GraphConnection(fc as never, "out", cons as never, "in") as never,
    );
    reconcileFcs(editor as never, null);
    return fc.socketDataType;
  };

  it("an out-wired FC stays provisional into anydata / anylist / anytable, exactly as into trueany", async () => {
    for (const dt of ["anydata", "anylist", "anycombo", "anytable", "any", "trueany"] as const) {
      expect(await fcInto(new SolenoidSocket(dt)), `${dt} should not be adopted as a family`)
        .toBe("trueany");
    }
  });

  it("a real type still resolves — including the non-family types that are genuinely resolved", async () => {
    expect(await fcInto(new SolenoidSocket("string"))).toBe("string");
    expect(await fcInto(new SolenoidSocket("datelist"))).toBe("datelist");
    // frame/lambda/chart carry no ELEMENT family but are resolved types with
    // their own FC treatment (none / view-as / text scale) — never provisional.
    expect(await fcInto(new SolenoidSocket("frame"))).toBe("frame");
    expect(await fcInto(new SolenoidSocket("lambda"))).toBe("lambda");
    expect(await fcInto(new SolenoidSocket("chart"))).toBe("chart");
  });
});

// ─── [[C10]] socketLattice at the retype seam ─────────────────────────────────────
// A Display's `in` is an adoptive trueany; once it has adopted a producer's rank-1
// type (datecombo), the producer's rank-2 reconcile (datetable) must judge the cable
// against the DECLARED rung, or the very adoption it caused prunes it. This is how
// the script-tour seed lost two Script → Display cables (2026-08-28).
describe("retypeOutputCables judges an adoptive input by its base rung", () => {
  it("keeps a cable whose target adopted the previous type", async () => {
    const editor = new GraphEditor() as unknown as AnyEditor;
    const src = new GraphNode("Src");
    src.addOutput("result", new GraphOutput(dateTableSocket, "Result")); // post-swap: datetable
    const disp = new GraphNode("Display");
    const sock = new AdoptiveSocket("trueany");
    sock.setType("datecombo"); // what it adopted from the pre-swap cable
    disp.addInput("in", new GraphInput(sock, "In"));
    for (const n of [src, disp]) await editor.addNode(n as never);
    const cable = new GraphConnection(src as never, "result", disp as never, "in");
    await editor.addConnection(cable as never);

    await retypeOutputCables(editor as never, stubArea, src.id, "result");

    expect(editor.getConnections().map((c) => c.id)).toContain(cable.id);
  });
});
