// [[C44]] dateSerials
import { describe, it, expect, vi } from "vitest";
import { hasVolatileDates, msUntilNextMidnight, armMidnightRollover } from "../../src/graph/volatileDates";
import { TodayNowNode } from "../../src/graph/nodes/date";
import { wallClockSerial, serialToJsDate } from "../../src/graph/nodes/dateSerial";
import { compileEvaluator } from "../../src/graph/excelFormula";

describe("volatileDates (R5 midnight rollover)", () => {
  it("spots TODAY()/NOW() in an expression or a frame's formulas, and a relative Date Input", () => {
    expect(hasVolatileDates([{ expr: "TODAY() + 7" }])).toBe(true);
    expect(hasVolatileDates([{ expr: "now()" }])).toBe(true);
    expect(hasVolatileDates([{ frameText: '[{"name":"Age","expr":"TODAY()-[Born]"}]' }])).toBe(true);
    expect(hasVolatileDates([{ stringLiterals: { date: "next friday" } }])).toBe(true);
    expect(hasVolatileDates([{ expr: "a + b" }, { stringLiterals: { date: "05-Jan-2026" } }, {}])).toBe(false);
  });
  it("spots a Today / Now card, and a volatile node inside a composite", () => {
    expect(hasVolatileDates([new TodayNowNode()])).toBe(true);
    expect(hasVolatileDates([{ internalEditor: { getNodes: () => [{ expr: "NOW()" }] } }])).toBe(true);
  });
  it("TODAY and NOW read the local wall clock, the same day the midnight rollover and a relative date use", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 23, 30, 0));
    const today = serialToJsDate(compileEvaluator("TODAY()")!({}) as number);
    expect([today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()]).toEqual([2026, 8, 7]);
    const now = serialToJsDate(new TodayNowNode({ op: "now" }).data().result);
    expect([now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()]).toEqual([7, 23, 30]);
    expect(new TodayNowNode().data().result).toBe(wallClockSerial(new Date(), true));
    vi.useRealTimers();
  });
  it("counts to the next local midnight (plus a second)", () => {
    const now = new Date(2026, 8, 7, 23, 59, 0);
    expect(msUntilNextMidnight(now)).toBe(61_000);
    expect(msUntilNextMidnight(new Date(2026, 8, 7, 0, 0, 30))).toBe((24 * 3600 - 29) * 1000);
  });
  it("fires the recalc at midnight only when a volatile node exists, then re-arms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 23, 59, 59));
    const nodes: unknown[] = [];
    const recalc = vi.fn();
    const disarm = armMidnightRollover(() => nodes, recalc);
    vi.advanceTimersByTime(3_000);
    expect(recalc).not.toHaveBeenCalled(); // nothing volatile
    nodes.push({ expr: "TODAY()" });
    vi.advanceTimersByTime(24 * 3600 * 1000);
    expect(recalc).toHaveBeenCalledTimes(1);
    disarm();
    vi.advanceTimersByTime(24 * 3600 * 1000);
    expect(recalc).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
