import { describe, it, expect } from "vitest";
import {
  civilFromSerial,
  serialFromCivil,
  dayOfWeek,
  isLeapYear,
  daysInMonth,
  isoWeek,
  usWeek,
  addMonths,
  startOfMonth,
  startOfWeek,
  fiscalQuarter,
  startOfFiscalQuarter,
  UNIX_EPOCH_SERIAL,
} from "./serial";

const S = (y: number, m: number, d: number) => serialFromCivil(y, m, d);

describe("serial ↔ civil", () => {
  it("anchors on the app's epoch (serial 25569 = 1970-01-01)", () => {
    expect(S(1970, 1, 1)).toBe(UNIX_EPOCH_SERIAL);
    expect(civilFromSerial(UNIX_EPOCH_SERIAL)).toEqual({ year: 1970, month: 1, day: 1 });
  });

  it("round-trips every day across two leap-spanning years", () => {
    for (let s = S(2019, 1, 1); s <= S(2021, 12, 31); s++) {
      const c = civilFromSerial(s);
      expect(serialFromCivil(c.year, c.month, c.day)).toBe(s);
    }
  });

  it("matches serialToJsDate's UTC weekday without a Date", () => {
    // 1970-01-01 is a Thursday (getUTCDay 4); 2021-01-01 a Friday (5).
    expect(dayOfWeek(S(1970, 1, 1))).toBe(4);
    expect(dayOfWeek(S(2021, 1, 1))).toBe(5);
    // Cross-check against the real Date for a sweep — this is the DST-proof property.
    for (let s = S(2025, 1, 1); s <= S(2027, 12, 31); s += 1) {
      const utc = new Date((s - UNIX_EPOCH_SERIAL) * 86400000).getUTCDay();
      expect(dayOfWeek(s)).toBe(utc);
    }
  });
});

describe("leap years", () => {
  it("knows the century rule", () => {
    expect(isLeapYear(2020)).toBe(true);
    expect(isLeapYear(2021)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
  it("Feb has 29 days only in a leap year", () => {
    expect(daysInMonth(2020, 2)).toBe(29);
    expect(daysInMonth(2021, 2)).toBe(28);
    expect(daysInMonth(2021, 1)).toBe(31);
  });
});

describe("week numbering", () => {
  it("2021-01-01 (Fri) is ISO week 53 but US week 1", () => {
    expect(isoWeek(S(2021, 1, 1))).toBe(53);
    expect(usWeek(S(2021, 1, 1))).toBe(1);
  });
  it("2020-01-01 (Wed) is ISO week 1", () => {
    expect(isoWeek(S(2020, 1, 1))).toBe(1);
  });
  it("startOfWeek snaps back to the chosen first weekday", () => {
    // Monday-start: any day in the week maps to that Monday.
    const mon = S(2026, 9, 7); // 2026-09-07 is a Monday
    expect(dayOfWeek(mon)).toBe(1);
    for (let i = 0; i < 7; i++) expect(startOfWeek(mon + i, 1)).toBe(mon);
    // Sunday-start (US): the Sunday before.
    expect(startOfWeek(mon, 0)).toBe(mon - 1);
  });
});

describe("month + fiscal helpers", () => {
  it("startOfMonth and addMonths walk calendar months", () => {
    expect(civilFromSerial(startOfMonth(S(2026, 3, 15)))).toEqual({ year: 2026, month: 3, day: 1 });
    expect(civilFromSerial(addMonths(S(2026, 1, 31), 1))).toEqual({ year: 2026, month: 2, day: 28 });
    expect(civilFromSerial(addMonths(S(2026, 12, 10), 1))).toEqual({ year: 2027, month: 1, day: 10 });
  });
  it("fiscal quarters honor a non-January start", () => {
    // Fiscal year starting in April: April = Q1.
    expect(fiscalQuarter(S(2026, 4, 1), 4).quarter).toBe(1);
    expect(fiscalQuarter(S(2026, 3, 31), 4).quarter).toBe(4);
    expect(civilFromSerial(startOfFiscalQuarter(S(2026, 5, 20), 4))).toEqual({ year: 2026, month: 4, day: 1 });
    // Calendar fiscal year: Jan = Q1.
    expect(fiscalQuarter(S(2026, 1, 15), 1).quarter).toBe(1);
    expect(fiscalQuarter(S(2026, 12, 15), 1).quarter).toBe(4);
  });
});
