import { describe, it, expect } from "vitest";
import {
  isValidZone, zoneOffsetMs, convertZone, worldClockRows, worldClockFrame, placeLabel,
} from "../../src/graph/timeZone";
import { isSolError } from "../../src/graph/errorValue";

// C1 Time Zone Convert + World Clock — the Intl reinterpretation is pure + fixture-tested
// (widget rule 5). Serials are wall-clock-as-UTC, so a serial is built the same way.
const serial = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, 0) / 86400000 + 25569;

describe("isValidZone", () => {
  it("accepts IANA names, rejects junk", () => {
    expect(isValidZone("America/New_York")).toBe(true);
    expect(isValidZone("UTC")).toBe(true);
    expect(isValidZone("Not/AZone")).toBe(false);
    expect(isValidZone("")).toBe(false);
  });
});

describe("zoneOffsetMs", () => {
  const H = 3600000;
  it("UTC is always zero", () => {
    expect(zoneOffsetMs("UTC", Date.UTC(2026, 0, 1))).toBe(0);
    expect(zoneOffsetMs("UTC", Date.UTC(2026, 6, 1))).toBe(0);
  });
  it("tracks DST: New York is -5h in winter, -4h in summer", () => {
    expect(zoneOffsetMs("America/New_York", Date.UTC(2026, 0, 15, 12))).toBe(-5 * H);
    expect(zoneOffsetMs("America/New_York", Date.UTC(2026, 6, 15, 12))).toBe(-4 * H);
  });
});

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

describe("placeLabel", () => {
  it("takes the last segment and spaces underscores", () => {
    expect(placeLabel("America/New_York")).toBe("New York");
    expect(placeLabel("Europe/London")).toBe("London");
    expect(placeLabel("UTC")).toBe("UTC");
  });
});

describe("worldClockRows / worldClockFrame", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0); // 12:00 UTC
  it("formats each zone's local time and labels the place", () => {
    const rows = worldClockRows(["UTC", "Asia/Tokyo"], now);
    expect(rows.map((r) => r.place)).toEqual(["UTC", "Tokyo"]);
    expect(rows[0].time).toMatch(/12:00/);   // UTC noon
    expect(rows[1].time).toMatch(/21:00/);   // Tokyo is UTC+9
  });
  it("drops blank entries and marks an unknown zone", () => {
    const rows = worldClockRows(["  ", "Bad/Zone", "UTC"], now);
    expect(rows.map((r) => r.place)).toEqual(["Bad/Zone", "UTC"]);
    expect(rows[0].time).toBe("?");
  });
  it("builds a Place / Local frame aligned by row", () => {
    const f = worldClockFrame(worldClockRows(["UTC", "Europe/London"], now));
    expect(f.columns.map((c) => c.name)).toEqual(["Place", "Local"]);
    expect(f.columns.map((c) => c.type)).toEqual(["string", "string"]);
    expect(f.columns[0].values).toEqual(["UTC", "London"]);
  });
});

// shareImpl capability parity: the node and the formula surface share `convertZone`, and
// the agreement is asserted, not assumed (the behavioural guard rules.md names).
describe("TIMEZONECONVERT ↔ Time Zone Convert node", () => {
  it("the formula computes what the node computes", async () => {
    const { compileEvaluator } = await import("../../src/graph/excelFormula");
    const { TimeZoneConvertNode } = await import("../../src/graph/nodes/date");
    const s = serial(2026, 7, 4, 12, 0);
    const node = new TimeZoneConvertNode().data({ datetime: [s], from: ["America/New_York"], to: ["Asia/Tokyo"] });
    const f = compileEvaluator('TIMEZONECONVERT(s, "America/New_York", "Asia/Tokyo")');
    expect(f).not.toBeNull();
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
