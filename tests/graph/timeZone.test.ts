import { describe, it, expect } from "vitest";
import { coreFunction } from "./coreFunction";
import { isSolError } from "../../src/graph/errorValue";

const convertZone = (serial: number, from: string, to: string) => coreFunction("TIMEZONECONVERT")!(serial, from, to);

// C1 Time Zone Convert — the Intl reinterpretation is pure + fixture-tested
// (widget rule 5). Serials are wall-clock-as-UTC, so a serial is built the same way.
const serial = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, 0) / 86400000 + 25569;

describe("convertZone", () => {
  it("winter: 9:00 in New York (EST) is 14:00 in London", () => {
    const r = convertZone(serial(2026, 1, 15, 9, 0), "America/New_York", "Europe/London");
    expect(r).toBe(serial(2026, 1, 15, 14, 0));
  });

  it("summer, across the date line: noon New York (EDT) is next-day 01:00 in Tokyo", () => {
    const r = convertZone(serial(2026, 7, 4, 12, 0), "America/New_York", "Asia/Tokyo");
    expect(r).toBe(serial(2026, 7, 5, 1, 0));
  });

  it("same zone (and UTC↔UTC) is the identity", () => {
    const s = serial(2026, 3, 10, 8, 30);
    expect(convertZone(s, "UTC", "UTC")).toBe(s);
    expect(convertZone(s, "Asia/Tokyo", "Asia/Tokyo")).toBe(s);
  });

  it("an unknown zone is a #VALUE!", () => {
    const bad = convertZone(serial(2026, 1, 1), "Nope/Nowhere", "UTC");
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
    const bad2 = convertZone(serial(2026, 1, 1), "UTC", "Nope/Nowhere");
    expect(isSolError(bad2)).toBe(true);
  });

  it("a non-finite serial is a #VALUE!", () => {
    expect(isSolError(convertZone(NaN, "UTC", "Asia/Tokyo"))).toBe(true);
  });
});

// [[C17]] shareImpl capability parity: the node and the formula surface share `convertZone`, and
// the agreement is asserted, not assumed (the behavioural guard [[C17]] shareImpl names).
describe("TIMEZONECONVERT ↔ Time Zone Convert node", () => {
  it("the formula computes what the node computes", async () => {
    const { compileEvaluator } = await import("../../src/graph/excelFormula");
    const { TimeZoneConvertNode } = await import("../../src/graph/nodes/date");
    const s = serial(2026, 7, 4, 12, 0);
    const node = new TimeZoneConvertNode().data({ datetime: [s], from: ["America/New_York"], to: ["Asia/Tokyo"] });
    const f = compileEvaluator('TIMEZONECONVERT(s, "America/New_York", "Asia/Tokyo")');
    expect(f!({ s })).toBe(node.result);
    expect(node.result).toBe(serial(2026, 7, 5, 1, 0));
  });

  it("a blank argument is quiet; an unknown zone is a #VALUE!", async () => {
    const { compileEvaluator } = await import("../../src/graph/excelFormula");
    expect(compileEvaluator('TIMEZONECONVERT(s, "UTC", "Asia/Tokyo")')!({ s: null })).toBeNull();
    const bad = compileEvaluator('TIMEZONECONVERT(s, "UTC", "Nowhere/Land")')!({ s: serial(2026, 1, 1) });
    expect(isSolError(bad)).toBe(true);
  });
});
