import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { retypeOutputCables } from "./fcReconcile";
import { stringSocket, anySocket, numberSocket, SolenoidSocket } from "./sockets";
import { FormatControllerNode } from "./nodes/formatController";

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;
// reconcileFcTypes only calls area.update for FC/Convert nodes (none here), so a
// no-op stub suffices to exercise retypeOutputCables' cable-keep logic.
const stubArea = { update: async () => {} } as never;

describe("retypeOutputCables (Cast / LAMBDA / Get Column shared retype path)", () => {
  it("keeps a cable to an `any` input but drops a now-incompatible typed one", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const src = new ClassicPreset.Node("Src");
    src.addOutput("result", new ClassicPreset.Output(stringSocket, "Result")); // post-swap type = string
    const consAny = new ClassicPreset.Node("Any");
    consAny.addInput("in", new ClassicPreset.Input(anySocket, "In"));
    const consNum = new ClassicPreset.Node("Num");
    consNum.addInput("in", new ClassicPreset.Input(numberSocket, "In"));
    for (const n of [src, consAny, consNum]) await editor.addNode(n as never);
    const toAny = new ClassicPreset.Connection(src as never, "result", consAny as never, "in");
    const toNum = new ClassicPreset.Connection(src as never, "result", consNum as never, "in");
    await editor.addConnection(toAny as never);
    await editor.addConnection(toNum as never);

    await retypeOutputCables(editor as never, stubArea, src.id, "result");

    const ids = editor.getConnections().map((c) => c.id);
    expect(ids).toContain(toAny.id);   // string → any: kept
    expect(ids).not.toContain(toNum.id); // string → number: dropped (incompatible)
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
    const editor = new NodeEditor() as unknown as AnyEditor;
    const fc = new FormatControllerNode({});
    const cons = new ClassicPreset.Node("Consumer");
    cons.addInput("in", new ClassicPreset.Input(consumerSocket, "In"));
    for (const n of [fc, cons]) await editor.addNode(n as never);
    await editor.addConnection(
      new ClassicPreset.Connection(fc as never, "out", cons as never, "in") as never,
    );
    fc.adaptTypeFromConnections(editor as never);
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
