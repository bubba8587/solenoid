// [[C44]] dateSerials
import { describe, it, expect, vi } from "vitest";
import { hasVolatileDates, msUntilNextMidnight, armMidnightRollover } from "../../src/graph/volatileDates";
import { TodayNowNode, WorldClockNode } from "../../src/graph/nodes/date";
import { HolidaysNode } from "../../src/graph/nodes/connection";
import { wallClockSerial, serialToJsDate } from "../../src/graph/nodes/dateSerial";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { CubeInputNode } from "../../src/graph/nodes/cube";
import { FrameInputNode, ComputedColumnNode } from "../../src/graph/nodes/frame";
import { requestRecalc } from "../../src/graph/process";

describe("volatileDates (R5 midnight rollover)", () => {
  it("spots TODAY()/NOW() in an expression or a frame's formulas, and a relative Date Input", () => {
    expect(hasVolatileDates([{ expr: "TODAY() + 7" }])).toBe(true);
    expect(hasVolatileDates([{ expr: "now()" }])).toBe(true);
    expect(hasVolatileDates([{ frameText: '[{"name":"Age","expr":"TODAY()-[Born]"}]' }])).toBe(true);
    expect(hasVolatileDates([{ stringLiterals: { date: "next friday" } }])).toBe(true);
    expect(hasVolatileDates([{ expr: "a + b" }, { stringLiterals: { date: "05-Jan-2026" } }, {}])).toBe(false);
  });
  it("spots TODAY() in a Cube Input's formula column", () => {
    const cube = new CubeInputNode({ cubeText: JSON.stringify({ columns: [{ name: "a" }, { name: "d", expr: "TODAY()" }], rows: [{ a: 1 }] }) });
    expect(hasVolatileDates([cube])).toBe(true);
    expect(hasVolatileDates([new CubeInputNode()])).toBe(false);
  });
  it("spots a Note or Report template that dates 'now'", () => {
    expect(hasVolatileDates([{ body: "Updated {{ 'now' | date: '%d %b' }}" }])).toBe(true);
    expect(hasVolatileDates([{ body: 'day: "{{ "now" | date }}"' }])).toBe(true);
    expect(hasVolatileDates([{ body: "Written {{ created | date }}, not now" }])).toBe(false);
  });
  it("spots a Today / Now, Holidays or World Clock card, and a volatile node inside a composite", () => {
    expect(hasVolatileDates([new TodayNowNode()])).toBe(true);
    expect(hasVolatileDates([new HolidaysNode()])).toBe(true);
    expect(hasVolatileDates([new WorldClockNode()])).toBe(true);
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

describe("volatile formula columns refresh on a recalc", () => {
  const dayOf = (serial: unknown) => serialToJsDate(serial as number).getUTCDate();
  it("a Frame Input formula column reads the new day after midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 23, 59, 0));
    const node = new FrameInputNode({ frameText: JSON.stringify([{ name: "a", values: [1] }, { name: "d", expr: "TODAY()" }]) });
    const cell = () => node.data({}).frame.columns.find((c) => c.name === "d")!.values[0];
    expect(dayOf(cell())).toBe(7);
    vi.setSystemTime(new Date(2026, 8, 8, 0, 0, 1));
    await requestRecalc();
    expect(dayOf(cell())).toBe(8);
    vi.useRealTimers();
  });
  it("a Cube Input formula column reads the new day after midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 23, 59, 0));
    const node = new CubeInputNode({ cubeText: JSON.stringify({ columns: [{ name: "a" }, { name: "d", expr: "TODAY()" }], rows: [{ a: 1 }] }) });
    const cell = () => JSON.stringify(node.data().cube);
    const before = cell();
    vi.setSystemTime(new Date(2026, 8, 8, 0, 0, 1));
    await requestRecalc();
    expect(cell()).not.toBe(before);
    vi.useRealTimers();
  });
  it("a Computed Column calling TODAY reads the new day after F9, with the same input frame", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 23, 59, 0));
    const node = new ComputedColumnNode({ expr: "TODAY()" });
    node.stringLiterals.name = "d";
    const frame = { __frame: true as const, columns: [{ name: "a", type: "number" as const, values: [1] }] };
    const cell = () => (node.data({ frame: [frame] }).frame as { columns: { name: string; values: unknown[] }[] }).columns.find((c) => c.name === "d")!.values[0];
    expect(dayOf(cell())).toBe(7);
    vi.setSystemTime(new Date(2026, 8, 8, 0, 0, 1));
    await requestRecalc();
    expect(dayOf(cell())).toBe(8);
    vi.useRealTimers();
  });
});
