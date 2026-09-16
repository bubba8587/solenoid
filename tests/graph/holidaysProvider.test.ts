import { describe, it, expect } from "vitest";
import {
  holidaysUrl, parseHolidays, filterHolidays, holidaysFrame, daysToNextHoliday,
  NAGER_COUNTRIES, type Holiday,
} from "../../src/graph/holidaysProvider";
import { parseDateToSerial } from "../../src/graph/nodes/dateSerial";

// C1 Holidays — the Nager.Date parse + shaping is pure + fixture-tested (widget rule 5).

const usFixture = JSON.stringify([
  { date: "2026-01-01", localName: "New Year's Day", name: "New Year's Day", countryCode: "US", counties: null, global: true },
  { date: "2026-03-31", localName: "Cesar Chavez Day", name: "Cesar Chavez Day", countryCode: "US", counties: ["US-CA", "US-TX"], global: false },
  { date: "2026-07-04", localName: "Independence Day", name: "Independence Day", countryCode: "US", counties: null, global: true },
]);

describe("holidaysUrl", () => {
  it("builds the year/country endpoint, upper-casing and trimming the code", () => {
    expect(holidaysUrl(2026, " us ")).toBe("https://date.nager.at/api/v3/PublicHolidays/2026/US");
  });
  it("truncates a fractional year", () => {
    expect(holidaysUrl(2026.9, "GB")).toContain("/2026/GB");
  });
});

describe("parseHolidays", () => {
  it("parses each holiday with serial, names and counties", () => {
    const h = parseHolidays(usFixture);
    expect(h).toHaveLength(3);
    expect(h[0]).toEqual({ serial: parseDateToSerial("2026-01-01"), name: "New Year's Day", localName: "New Year's Day", counties: [] });
    expect(h[1].counties).toEqual(["US-CA", "US-TX"]);
    expect(h[2].name).toBe("Independence Day");
  });

  it("returns [] for malformed JSON or a non-array body", () => {
    expect(parseHolidays("not json")).toEqual([]);
    expect(parseHolidays("{}")).toEqual([]);
    expect(parseHolidays(JSON.stringify({ holidays: [] }))).toEqual([]);
  });

  it("drops a row with no date", () => {
    const h = parseHolidays(JSON.stringify([{ name: "Undated", counties: null }]));
    expect(h).toEqual([]);
  });
});

describe("filterHolidays — region keeps nationwide days plus that subdivision's", () => {
  const h = parseHolidays(usFixture);
  it("a blank region keeps everything", () => {
    expect(filterHolidays(h, "")).toHaveLength(3);
    expect(filterHolidays(h, "  ")).toHaveLength(3);
  });
  it("a region keeps nationwide days and its own subdivision days", () => {
    const ca = filterHolidays(h, "US-CA");
    expect(ca.map((x) => x.name)).toEqual(["New Year's Day", "Cesar Chavez Day", "Independence Day"]);
  });
  it("a region drops another subdivision's day", () => {
    const ny = filterHolidays(h, "US-NY");
    expect(ny.map((x) => x.name)).toEqual(["New Year's Day", "Independence Day"]);
  });
});

describe("holidaysFrame", () => {
  it("builds Date / Name / Local columns aligned by row", () => {
    const f = holidaysFrame(parseHolidays(usFixture));
    expect(f.columns.map((c) => c.name)).toEqual(["Date", "Name", "Local"]);
    expect(f.columns.map((c) => c.type)).toEqual(["date", "string", "string"]);
    expect(f.columns[0].values).toEqual([
      parseDateToSerial("2026-01-01"), parseDateToSerial("2026-03-31"), parseDateToSerial("2026-07-04"),
    ]);
    expect(f.columns[1].values[2]).toBe("Independence Day");
  });
  it("an empty set is an empty-but-shaped frame", () => {
    const f = holidaysFrame([]);
    expect(f.columns.map((c) => c.name)).toEqual(["Date", "Name", "Local"]);
    expect(f.columns[0].values).toEqual([]);
  });
});

describe("daysToNextHoliday — whole days to the next on/after today", () => {
  const mk = (serial: number): Holiday => ({ serial, name: "", localName: "", counties: [] });
  const set = [mk(100), mk(110), mk(130)];
  it("counts to the nearest upcoming holiday", () => {
    expect(daysToNextHoliday(set, 95)).toBe(5);
    expect(daysToNextHoliday(set, 105)).toBe(5);
  });
  it("today itself is zero", () => {
    expect(daysToNextHoliday(set, 110)).toBe(0);
  });
  it("null when none remain", () => {
    expect(daysToNextHoliday(set, 200)).toBeNull();
    expect(daysToNextHoliday([], 0)).toBeNull();
  });
});

describe("NAGER_COUNTRIES — the bundled picker list", () => {
  it("parses code + name, keeping multi-word names whole", () => {
    expect(NAGER_COUNTRIES.length).toBeGreaterThan(190);
    expect(NAGER_COUNTRIES.find((c) => c.code === "US")?.name).toBe("United States");
    expect(NAGER_COUNTRIES.find((c) => c.code === "GB")?.name).toBe("United Kingdom");
    expect(NAGER_COUNTRIES.find((c) => c.code === "BA")?.name).toBe("Bosnia and Herzegovina");
  });
  it("every entry has a two-letter code and a non-empty name", () => {
    for (const c of NAGER_COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});
