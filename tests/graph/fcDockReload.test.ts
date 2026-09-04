import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { FrameInputNode } from "../../src/graph/nodes/frame";
import { ListIndexNode } from "../../src/graph/nodes/list";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { DisplayNode } from "../../src/graph/nodes/display";
import { TodayNowNode } from "../../src/graph/nodes/date";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";
import { frameSourceToText, type FrameValue } from "../../src/graph/frame";
import type { Schemes } from "../../src/graph/schemes";

// ─── Docked-FC reload order (the "false Frame type on reload" bug) ────────────
// The author's chain: a computed column with a unit → INDEX pulls one cell →
// an FC DOCKED on INDEX's output. On load, dockSelf's adaptTypeFromConnections
// resolves the HOST socket — and before settleWildcardTypes has run, INDEX's
// projected wildcard output still reads as its upstream's raw type (frame), so
// the docked FC adopted "frame" and nothing re-adapted it after the settle.
// Re-docking by hand fixed it because that re-ran the adapt post-settle. The
// fix: persistence settles wildcard types BEFORE the dock loop. This test
// replays that exact load order.

type AnyEditor = NodeEditor<Schemes>;

async function buildChain() {
  const editor = new NodeEditor() as unknown as AnyEditor;
  const fi = new FrameInputNode({
    frameText: frameSourceToText([
      { name: "price", type: "number", cells: ["10", "20"] },
      { name: "rev", type: "number", cells: [], expr: "@price * 2", unit: "usd" },
    ]),
  });
  const idx = new ListIndexNode();
  idx.literals.index = 2;
  idx.literals.column = 2;
  const fc = new FormatControllerNode({ unit: "usd" });
  for (const n of [fi, idx, fc]) await editor.addNode(n as never);
  fc.hostNodeId = idx.id;
  fc.socketKey = "result";
  fc.side = "output";
  await editor.addConnection(new ClassicPreset.Connection(idx as never, "result", fc as never, "in") as never);
  await editor.addConnection(new ClassicPreset.Connection(fi as never, "frame", idx as never, "list") as never);
  return { editor, fi, idx, fc };
}

describe("a docked FC keeps its saved date style through load-time type hops", () => {
  // The author's chain: Script → Display → FC set to "Wed, Jun 3, 2026". A Script's
  // output type is only known after the data pass: at load the Display's `out` reads
  // the wildcard, then the Script's construction-time NUMBER family, then the real date
  // family. Re-defaulting the pick on each hop turned the saved date style into "auto"
  // and then into the FIRST date style. The pick is never rewritten now; a pick outside
  // the socket's family is inert (`effectiveFormat()`) until the family comes back.
  it("resolving through trueany leaves the pick alone; the real date type keeps it", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const disp = new DisplayNode();
    const fc = new FormatControllerNode({ format: "date_dow", socketDataType: "datelist" });
    for (const n of [disp, fc]) await editor.addNode(n as never);
    fc.hostNodeId = disp.id;
    fc.socketKey = "out";
    fc.side = "output";
    await editor.addConnection(new ClassicPreset.Connection(disp as never, "out", fc as never, "in") as never);

    // Load order with an unfed host: the type resolves to the wildcard.
    settleWildcardTypes(editor as never);
    fc.dockSelf(editor as never);
    expect(fc.socketDataType).toBe("trueany");
    expect(fc.format).toBe("date_dow");

    // The value's type arrives (here statically, a date source) — the pick stands.
    const today = new TodayNowNode();
    await editor.addNode(today as never);
    await editor.addConnection(new ClassicPreset.Connection(today as never, "result", disp as never, "in") as never);
    settleWildcardTypes(editor as never);
    fc.adaptTypeFromConnections(editor as never);
    expect(fc.socketDataType).toBe("date");
    expect(fc.format).toBe("date_dow");
  });

  it("a date pick on a number socket is INERT (effective auto), not rewritten — it returns with the family", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const fi = new FrameInputNode({ frameText: frameSourceToText([{ name: "n", type: "number", cells: ["1", "2"] }]) });
    const idx = new ListIndexNode();
    idx.literals.index = 1;
    idx.literals.column = 1;
    const fc = new FormatControllerNode({ format: "date_dow", socketDataType: "date" });
    for (const n of [fi, idx, fc]) await editor.addNode(n as never);
    fc.hostNodeId = idx.id;
    fc.socketKey = "result";
    fc.side = "output";
    await editor.addConnection(new ClassicPreset.Connection(idx as never, "result", fc as never, "in") as never);
    await editor.addConnection(new ClassicPreset.Connection(fi as never, "frame", idx as never, "list") as never);
    settleWildcardTypes(editor as never);
    fc.dockSelf(editor as never);
    expect(fc.socketDataType).toBe("numlist");
    expect(fc.format).toBe("date_dow");          // the pick survives
    expect(fc.effectiveFormat()).toBe("auto");    // but does not apply to a number
    expect(fc.annotation().format).toBe("auto");
  });
});

describe("docked FC survives a reload of the computed-column → INDEX chain", () => {
  it("MECHANISM: docking before the settle is exactly the bug — the FC adopts the raw upstream frame", async () => {
    // The pre-fix load order. If this half ever starts passing with "numlist",
    // adaptTypeFromConnections learned to project through unresolved wildcards
    // and the ordering constraint in persistence.ts can be relaxed.
    const { editor, fc } = await buildChain();
    fc.dockSelf(editor as never);
    settleWildcardTypes(editor as never);
    expect(fc.socketDataType).toBe("frame"); // the false Frame type
  });

  it("load order settles wildcard types before dockSelf — the FC adopts the cell's family, locked to its unit", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    // "Reload": nodes constructed from persisted state, cables restored, no
    // per-cable settle (the rebuild gate suppresses it).
    const fi = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "price", type: "number", cells: ["10", "20"] },
        { name: "rev", type: "number", cells: [], expr: "@price * 2", unit: "usd" },
      ]),
    });
    const idx = new ListIndexNode();
    idx.literals.index = 2;
    idx.literals.column = 2;
    const fc = new FormatControllerNode({ unit: "usd" });
    for (const n of [fi, idx, fc]) await editor.addNode(n as never);
    fc.hostNodeId = idx.id;
    fc.socketKey = "result";
    fc.side = "output";
    await editor.addConnection(new ClassicPreset.Connection(idx as never, "result", fc as never, "in") as never);
    await editor.addConnection(new ClassicPreset.Connection(fi as never, "frame", idx as never, "list") as never);

    // The FIXED load order: settle wildcard types, THEN register docks.
    settleWildcardTypes(editor as never);
    fc.dockSelf(editor as never);
    for (const n of editor.getNodes()) if (n instanceof FormatControllerNode) n.refreshAnnotation(editor as never);

    // The docked FC adopted the CELL's family (numlist — number's combo rung),
    // never the raw upstream "frame".
    expect(fc.socketDataType).toBe("numlist");

    // And the first compute pass locks it to the inherited unit.
    const frame = fi.data({}).frame as FrameValue;
    const cell = idx.data({ list: [frame] }).result;
    fc.data({ in: [cell] });
    expect(fc.forwarding).toBe(true);
    expect(fc.unitLocked).toBe(true);
    expect(fc.unit).toBe("usd");
  });
});
