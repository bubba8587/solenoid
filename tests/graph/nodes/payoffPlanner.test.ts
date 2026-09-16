import { describe, it, expect } from "vitest";
import { PayoffPlannerNode, payoffFrame } from "../../../src/graph/rete-nodes";
import { extractInit } from "../../../src/graph/copyPaste";
import { parseDateToSerial, formatDateSerial } from "../../../src/graph/nodes/dateSerial";
import { isSolError } from "../../../src/graph/errorValue";
import { isFrameValue, type FrameValue } from "../../../src/graph/frame";

const debts: FrameValue = { __frame: true, columns: [
  { name: "Debt", type: "string", values: ["Card", "Car"] },
  { name: "Balance", type: "number", values: [1000, 2000], unit: "usd" as never },
  { name: "APR", type: "number", values: [0.24, 0.06] },
  { name: "Min", type: "number", values: [100, 100] },
] };

describe("PayoffPlannerNode", () => {
  it("order + view persist through extractInit; stale values fall back", () => {
    const n = new PayoffPlannerNode({ order: "snowball", mode: "schedule" });
    const init = extractInit(n as never);
    expect(init.order).toBe("snowball");
    expect(init.mode).toBe("schedule");
    expect(new PayoffPlannerNode({ order: "x" as never, mode: "y" as never }).order).toBe("avalanche");
    expect(new PayoffPlannerNode().mode).toBe("summary");
  });

  it("summary: one row per debt with months, interest (Balance's unit) and a payoff date off the start", () => {
    const f = payoffFrame(debts, 50, "avalanche", "summary", parseDateToSerial("2026-01-01"));
    expect(f.columns.map((c) => c.name)).toEqual(["Debt", "Months", "Interest", "Payoff date"]);
    expect(f.columns[2].unit).toBe("usd");
    const months = f.columns[1].values as number[];
    expect(months[0]).toBeLessThan(months[1]); // the card clears first under avalanche
    const expected = new Date(Date.UTC(2026, months[0], 1));
    expect(formatDateSerial(f.columns[3].values[0] as number, "YYYY-MM")).toBe(`${expected.getUTCFullYear()}-${String(expected.getUTCMonth() + 1).padStart(2, "0")}`);
  });

  it("schedule: Month plus a balance column per debt, month 0 the starting balances", () => {
    const f = payoffFrame(debts, 0, "snowball", "schedule", null);
    expect(f.columns.map((c) => c.name)).toEqual(["Month", "Card", "Car"]);
    expect(f.columns[1].values[0]).toBe(1000);
    expect(f.columns[2].values[0]).toBe(2000);
    expect(f.columns[0].values.length).toBeGreaterThan(10);
  });

  it("the node reads a wired extra (a wired blank = 0) and turns a runaway plan into #VALUE!", () => {
    const n = new PayoffPlannerNode();
    n.literals.extra = 500;
    expect(isFrameValue(n.data({ debts: [debts], extra: [null] }).frame)).toBe(true);
    const runaway: FrameValue = { __frame: true, columns: [
      { name: "Debt", type: "string", values: ["Trap"] },
      { name: "Balance", type: "number", values: [10000] },
      { name: "APR", type: "number", values: [0.5] },
      { name: "Min", type: "number", values: [10] },
    ] };
    const out = new PayoffPlannerNode().data({ debts: [runaway] });
    expect(isSolError(out.frame) ? out.frame.message : "").toMatch(/Trap/);
  });
});
