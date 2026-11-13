// [[C23]] calcModes, [[alert-node-alerts-hud#When it fires]], [[alert-node-alerts-hud#Modes]], [[alert-node-alerts-hud#When it fires]]
import { describe, it, expect, beforeEach } from "vitest";
import { AlertNode } from "../../../src/graph/nodes/display";
import { extractInit } from "../../../src/graph/nodeInit";
import { alertStore } from "../../../src/graph/alertStore";
import { solError } from "../../../src/graph/errorValue";
import { beginGraphRebuild, endGraphRebuild } from "../../../src/graph/process";
import { inEditor } from "../cardPasses";

describe("AlertNode", () => {
  beforeEach(() => alertStore.clear());

  it("fires from the engine's direct call on a change of status, and not while the graph rebuilds", async () => {
    const n = new AlertNode({ label: "Temp" });
    n.literals = { value: 150, low: 0, high: 100, target: 0 };
    const g = await inEditor(n);
    expect(await g.pass("result")).toBe(2);
    expect(alertStore.list().map((a) => a.message)).toEqual(["Temp: 150 above 100"]);
    await g.pass("result");
    expect(alertStore.list()).toHaveLength(1);
    n.literals = { value: -5, low: 0, high: 100, target: 0 };
    n.edited();
    beginGraphRebuild();
    try { expect(await g.pass("result")).toBe(1); } finally { endGraphRebuild(); }
    expect(alertStore.list()).toHaveLength(1);
    await g.pass("result");
    expect(alertStore.list()).toHaveLength(1);
    g.dispose();
  });

  it("round-trips mode through extractInit", () => {
    const n = new AlertNode({ condition: "boolean" });
    expect(extractInit(n).condition).toBe("boolean");
    expect(new AlertNode(extractInit(n)).condition).toBe("boolean");
  });

  it("fires on the first eval when a wired value is already out of range", () => {
    const n = new AlertNode();
    n.data({ value: [150], low: [0], high: [100] }); // born triggered → fires
    expect(alertStore.list().length).toBe(1);
  });

  it("fires once per calm→alert edge, not while held, and re-arms", () => {
    const n = new AlertNode();
    n.data({ value: [50], low: [0], high: [100] });  // calm
    expect(alertStore.list().length).toBe(0);
    n.data({ value: [150], low: [0], high: [100] }); // rising edge → 1
    expect(alertStore.list().length).toBe(1);
    n.data({ value: [160], low: [0], high: [100] }); // still HIGH → no new fire
    expect(alertStore.list().length).toBe(1);
    n.data({ value: [50], low: [0], high: [100] });  // back calm
    n.data({ value: [150], low: [0], high: [100] }); // out again → 2
    expect(alertStore.list().length).toBe(2);
  });

  it("re-fires when the range status changes between LOW and HIGH", () => {
    const n = new AlertNode();
    n.data({ value: [50], low: [0], high: [100] });   // calm
    n.data({ value: [150], low: [0], high: [100] });  // HIGH → fire (1)
    expect(alertStore.list().length).toBe(1);
    n.data({ value: [200], low: [0], high: [100] });  // HIGH→HIGH → no fire
    expect(alertStore.list().length).toBe(1);
    n.data({ value: [-5], low: [0], high: [100] });   // HIGH→LOW → fire (2)
    expect(alertStore.list().length).toBe(2);
    n.data({ value: [-9], low: [0], high: [100] });   // LOW→LOW → no fire
    expect(alertStore.list().length).toBe(2);
    n.data({ value: [150], low: [0], high: [100] });  // LOW→HIGH → fire (3)
    expect(alertStore.list().length).toBe(3);
  });

  it("switching into an already-met condition fires once (carry-over value)", () => {
    const n = new AlertNode({ condition: "boolean" });
    n.data({ value: [1] });                          // boolean: TRUE → fires
    expect(alertStore.list().length).toBe(1);
    n.condition = "range";                                // component flips mode…
    n.data({ value: [1], low: [5], high: [100] });   // …recompute: 1 < 5, fresh eval → fires
    expect(alertStore.list().length).toBe(2);
    n.data({ value: [1], low: [5], high: [100] });   // held → no new fire
    expect(alertStore.list().length).toBe(2);
  });

  it("boolean mode means TRUE (=== 1), not any nonzero value", () => {
    const n = new AlertNode({ condition: "boolean" });
    n.data({ value: [0] });   // false → calm
    n.data({ value: [5] });   // nonzero but NOT true → still calm
    expect(alertStore.list().length).toBe(0);
    n.data({ value: [1] });   // TRUE → fires
    expect(alertStore.list().length).toBe(1);
  });

  it("equals mode fires when the value matches the target", () => {
    const n = new AlertNode({ condition: "equals" });
    n.data({ value: [5], target: [7] });             // no match (calm)
    expect(alertStore.list().length).toBe(0);
    n.data({ value: [7], target: [7] });             // match → fires
    expect(alertStore.list().length).toBe(1);
  });

  it("text mode fires when the text contains the match string", () => {
    const n = new AlertNode({ condition: "text", label: "Log" });
    n.data({ text: ["all good"], match: ["error"] }); // no match
    expect(alertStore.list().length).toBe(0);
    n.data({ text: ["fatal error"], match: ["error"] }); // contains → fires
    expect(alertStore.list().length).toBe(1);
    expect(alertStore.list()[0].message).toContain("Log");
  });

  it("a blank or error cell in a list is not alerting", () => {
    const n = new AlertNode();
    const err = solError("#VALUE!", "x") as unknown as number;
    n.data({ value: [[50, null as unknown as number, err]], low: [0], high: [100] });
    expect(alertStore.list().length).toBe(0);
    n.data({ value: [[150, null as unknown as number, err]], low: [0], high: [100] });
    expect(alertStore.list().length).toBe(1);
    expect(alertStore.list()[0].message).toBe("Alert: 1 above 100");
  });

});
