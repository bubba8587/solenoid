import { describe, it, expect, vi } from "vitest";
import { hasVolatileDates, msUntilNextMidnight, armMidnightRollover } from "../../src/graph/volatileDates";

describe("volatileDates (R5 midnight rollover)", () => {
  it("spots TODAY()/NOW() in an expression or a frame's formulas, and a relative Date Input", () => {
    expect(hasVolatileDates([{ expr: "TODAY() + 7" }])).toBe(true);
    expect(hasVolatileDates([{ expr: "now()" }])).toBe(true);
    expect(hasVolatileDates([{ frameText: '[{"name":"Age","expr":"TODAY()-[Born]"}]' }])).toBe(true);
    expect(hasVolatileDates([{ stringLiterals: { date: "next friday" } }])).toBe(true);
    expect(hasVolatileDates([{ expr: "a + b" }, { stringLiterals: { date: "05-Jan-2026" } }, {}])).toBe(false);
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
