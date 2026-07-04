import { describe, it, expect, afterEach } from "vitest";
import { DateIfNode, DateAddNode, TimeValueNode, DateConstructNode, parseDateToSerial, serialToJsDate, jsDateToSerial, type DateIfUnit } from "./date";
import { isSolError } from "../errorValue";

describe("DATE — numeric year is literal (no century guessing)", () => {
  const yr = (serial: number) => serialToJsDate(serial).getUTCFullYear();
  it("a small year is that literal year, not 1900+year", () => {
    const r = new DateConstructNode().data({ year: [26], month: [1], day: [15] }).result;
    expect(isSolError(r)).toBe(false);
    expect(yr(r as number)).toBe(26); // 26 AD, NOT 1926
  });
  it("a full year round-trips", () => {
    const r = new DateConstructNode().data({ year: [2026], month: [3], day: [15] }).result;
    expect(r).toBe(jsDateToSerial(new Date(Date.UTC(2026, 2, 15))));
  });
  it("year outside 1–9999 is #DOMAIN!", () => {
    const zero = new DateConstructNode().data({ year: [0], month: [1], day: [1] }).result;
    expect(isSolError(zero) && zero.code).toBe("#DOMAIN!");
    const huge = new DateConstructNode().data({ year: [10000], month: [1], day: [1] }).result;
    expect(isSolError(huge) && huge.code).toBe("#DOMAIN!");
  });
});

describe("parseDateToSerial — a year token must be exactly four digits", () => {
  it("a 2-digit year in a numeric date is not a date", () => {
    expect(parseDateToSerial("1/15/26")).toBeNaN();
    expect(parseDateToSerial("1-15-26")).toBeNaN();
    expect(parseDateToSerial("26-01-15")).toBeNaN();
  });
  it("a 4-digit year still parses", () => {
    expect(parseDateToSerial("1/15/2026")).toBe(jsDateToSerial(new Date(Date.UTC(2026, 0, 15))));
    // "0026" is a 4-digit token → 26 AD. (Date.UTC(26,…) would remap to 1926, so
    // build the year-26 reference with setUTCFullYear, which does not remap.)
    const y26 = new Date(Date.UTC(2026, 0, 15)); y26.setUTCFullYear(26);
    expect(parseDateToSerial("0026-01-15")).toBe(jsDateToSerial(y26));
  });
});

// Dates flow through the graph as Excel-style serials (1900 system, where the
// JS epoch is serial 25569). Build them the same way the date nodes do.
const ser = (y: number, m: number, d: number) =>
  jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));

describe("serial ↔ JS Date", () => {
  it("round-trips", () => {
    const d = new Date(Date.UTC(2024, 1, 29));
    expect(serialToJsDate(jsDateToSerial(d)).getTime()).toBe(d.getTime());
  });
  it("JS epoch is serial 25569", () => {
    expect(jsDateToSerial(new Date(Date.UTC(1970, 0, 1)))).toBe(25569);
  });
});

describe("DATEDIF", () => {
  const diff = (unit: DateIfUnit, s: number, e: number) =>
    new DateIfNode({ unit }).data({ start: [s], end: [e] }).result;

  it("Y counts complete years", () => {
    expect(diff("Y", ser(2020, 5, 10), ser(2024, 5, 9))).toBe(3);
    expect(diff("Y", ser(2020, 5, 10), ser(2024, 5, 10))).toBe(4);
  });

  it("M counts complete months", () => {
    expect(diff("M", ser(2024, 1, 31), ser(2024, 2, 28))).toBe(0);
    expect(diff("M", ser(2024, 1, 15), ser(2024, 3, 15))).toBe(2);
    expect(diff("M", ser(2020, 5, 10), ser(2024, 3, 9))).toBe(45);
  });

  it("D counts days", () => {
    expect(diff("D", ser(2024, 1, 1), ser(2024, 12, 31))).toBe(365); // leap year
    expect(diff("D", ser(2023, 1, 1), ser(2023, 12, 31))).toBe(364);
  });

  it("MD matches Excel where Excel is well-defined", () => {
    // Same-or-later day in the month: plain difference.
    expect(diff("MD", ser(2024, 5, 10), ser(2024, 8, 15))).toBe(5);
    // The regression the outside review caught: borrow from the month before
    // the end month. Excel returns 28 here; the unclamped Date.UTC rollover
    // construct gave 26.
    expect(diff("MD", ser(2024, 1, 31), ser(2024, 2, 28))).toBe(28);
    // Borrow across a leap February (29 days in the month before March).
    expect(diff("MD", ser(2024, 1, 15), ser(2024, 3, 10))).toBe(24);
    // Non-leap February borrow.
    expect(diff("MD", ser(2023, 1, 15), ser(2023, 3, 10))).toBe(23);
  });

  it("YM counts months ignoring years", () => {
    expect(diff("YM", ser(2020, 5, 10), ser(2024, 3, 9))).toBe(9);
    expect(diff("YM", ser(2024, 1, 15), ser(2024, 3, 15))).toBe(2);
  });

  it("YD counts days ignoring years", () => {
    expect(diff("YD", ser(2024, 1, 10), ser(2024, 3, 15))).toBe(65); // leap Feb
    expect(diff("YD", ser(2023, 3, 1), ser(2024, 2, 1))).toBe(337);
  });

  it("equal dates are 0 in every unit", () => {
    const d = ser(2024, 6, 12);
    for (const unit of ["Y", "M", "D", "MD", "YM", "YD"] as const) {
      expect(diff(unit, d, d)).toBe(0);
    }
  });

  it("start after end returns null", () => {
    expect(diff("D", ser(2024, 2, 1), ser(2024, 1, 1))).toBeNull();
  });
});

describe("parseDateToSerial is timezone-independent (v1.0 audit P0-1)", () => {
  // process.env.TZ takes effect on subsequently-created Dates on Linux, which is
  // where the suite runs; each case must yield the SAME serial in every zone.
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  const zones = ["UTC", "Australia/Sydney", "America/New_York", "Pacific/Kiritimati"];
  const inEveryZone = (text: string) =>
    zones.map((tz) => {
      process.env.TZ = tz;
      return parseDateToSerial(text);
    });

  it("the app's own default display format round-trips to an integer serial everywhere", () => {
    const expected = jsDateToSerial(new Date(Date.UTC(2026, 0, 1)));
    for (const serial of inEveryZone("01-Jan-2026")) expect(serial).toBe(expected);
  });

  it("US-style text gives an integer serial everywhere", () => {
    const expected = jsDateToSerial(new Date(Date.UTC(2026, 0, 3)));
    for (const serial of inEveryZone("Jan 3 2026")) expect(serial).toBe(expected);
  });

  it("ISO date-only stays correct (spec already parses it as UTC)", () => {
    const expected = jsDateToSerial(new Date(Date.UTC(2026, 0, 3)));
    for (const serial of inEveryZone("2026-01-03")) expect(serial).toBe(expected);
  });

  it("a zone-less datetime keeps its wall-clock time everywhere", () => {
    const expected = jsDateToSerial(new Date(Date.UTC(2026, 0, 3, 10, 30)));
    for (const serial of inEveryZone("2026-01-03T10:30")) expect(serial).toBe(expected);
  });

  it("an explicit zone designator stays an absolute instant", () => {
    const expected = jsDateToSerial(new Date(Date.UTC(2026, 0, 3, 15, 0)));
    for (const serial of inEveryZone("2026-01-03T10:00-05:00")) expect(serial).toBe(expected);
    for (const serial of inEveryZone("2026-01-03T15:00Z")) expect(serial).toBe(expected);
  });

  it("garbage still returns NaN", () => {
    expect(parseDateToSerial("not a date")).toBeNaN();
    expect(parseDateToSerial("")).toBeNaN();
  });
});

describe("EDATE clamps to month end (v1.0 audit finding 11)", () => {
  const edate = (y: number, m: number, d: number, months: number) =>
    new DateAddNode({ op: "edate" }).data({ start: [ser(y, m, d)], months: [months] }).result;

  it("Jan 31 + 1mo = Feb 28 (not Mar 3)", () => {
    expect(edate(2023, 1, 31, 1)).toBe(ser(2023, 2, 28));
  });
  it("Jan 31 + 1mo = Feb 29 in a leap year", () => {
    expect(edate(2024, 1, 31, 1)).toBe(ser(2024, 2, 29));
  });
  it("Mar 31 - 1mo = Feb 29 in a leap year", () => {
    expect(edate(2024, 3, 31, -1)).toBe(ser(2024, 2, 29));
  });
  it("mid-month days are untouched", () => {
    expect(edate(2024, 1, 15, 1)).toBe(ser(2024, 2, 15));
    expect(edate(2024, 1, 15, 13)).toBe(ser(2025, 2, 15));
  });
});

describe("TIMEVALUE is timezone-independent (v1.0 audit finding 12)", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  const tv = (text: string) => {
    const n = new TimeValueNode();
    n.stringLiterals.text = text;
    return n.data({}).result;
  };

  it("14:30:00 is 14.5h in every zone (Excel 0.604…)", () => {
    for (const tz of ["UTC", "Europe/Berlin", "America/New_York"]) {
      process.env.TZ = tz;
      expect(tv("14:30:00")).toBeCloseTo(14.5 / 24, 12);
    }
  });
  it("supports h:mm and AM/PM", () => {
    expect(tv("2:30 PM")).toBeCloseTo(14.5 / 24, 12);
    expect(tv("12:00 AM")).toBeCloseTo(0, 12);
    expect(tv("12:00 PM")).toBeCloseTo(0.5, 12);
    expect(tv("9:05")).toBeCloseTo((9 * 3600 + 5 * 60) / 86400, 12);
  });
  it("a full datetime text keeps only the fraction (Excel TIMEVALUE)", () => {
    expect(tv("2026-01-03T06:00")).toBeCloseTo(0.25, 12);
  });
  it("garbage is #VALUE!", () => {
    const r = tv("25:99");
    if (!isSolError(r)) throw new Error("expected SolError");
    expect(r.code).toBe("#VALUE!");
  });
});
