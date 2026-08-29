import { describe, it, expect, afterEach } from "vitest";
import { DateAddNode, DateTimeValueNode, DateConstructNode, WorkdaysNode, DatePartNode, WeekInfoNode, DateDiffNode, TimeConstructNode, parseDateToSerial, parseDate, serialToJsDate, jsDateToSerial, type DateDiffOp } from "./date";
import { isSolError } from "../errorValue";
import { SolenoidSocket } from "../sockets";

// 2023-01-02 is a Monday; the working week Mon 2 … Fri 6 has no weekend inside it.
const MON = parseDateToSerial("2023-01-02");
const WED = parseDateToSerial("2023-01-04");
const FRI = parseDateToSerial("2023-01-06");

describe("WORKDAY / NETWORKDAYS — optional holidays list (Excel [holidays] parity)", () => {
  it("NETWORKDAYS skips holidays as well as weekends", () => {
    // Mon–Fri = 5 working days; a holiday on Wed drops it to 4.
    expect(new WorkdaysNode({ op: "networkdays" }).data({ start: [MON], end: [FRI] }).result).toBe(5);
    expect(new WorkdaysNode({ op: "networkdays" }).data({ start: [MON], end: [FRI], holidays: [[WED]] }).result).toBe(4);
    // A holiday OUTSIDE the range doesn't change the count.
    expect(new WorkdaysNode({ op: "networkdays" }).data({ start: [MON], end: [FRI], holidays: [[FRI + 10]] }).result).toBe(5);
    // A holiday that falls on a weekend isn't double-subtracted (still 5).
    expect(new WorkdaysNode({ op: "networkdays" }).data({ start: [MON], end: [FRI], holidays: [[MON - 1]] }).result).toBe(5);
  });

  it("WORKDAY steps over a holiday", () => {
    // 1 working day after Mon = Tue; with Tue a holiday it lands on Wed.
    // Scalar in → scalar out (broadcast only builds a list when an operand is one).
    const tue = new WorkdaysNode({ op: "workday" }).data({ start: [MON], days: [1] }).result as number;
    const wed = new WorkdaysNode({ op: "workday" }).data({ start: [MON], days: [1], holidays: [[tue]] }).result as number;
    expect(wed).toBe(tue + 1);
  });

  it("empty / unwired holidays behaves exactly as before", () => {
    expect(new WorkdaysNode({ op: "networkdays" }).data({ start: [MON], end: [FRI], holidays: [[]] }).result).toBe(5);
    expect(new WorkdaysNode({ op: "networkdays" }).data({ start: [MON], end: [FRI], holidays: undefined }).result).toBe(5);
  });
});

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

describe("parseDate — wider formats, day-first, and #AMBIGUOUS! (chrono-backed)", () => {
  const iso = (y: number, m: number, d: number) => jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));
  const ser = (s: string) => parseDate(s);
  it("parses ordinals and natural month-name forms", () => {
    expect(ser("march 15th, 1996")).toBe(iso(1996, 3, 15));
    expect(ser("3rd Apr 2026")).toBe(iso(2026, 4, 3));
    expect(ser("15 March 1996")).toBe(iso(1996, 3, 15));
  });
  it("accepts numeric day-first with -, /, or . separators", () => {
    expect(ser("20-02-2026")).toBe(iso(2026, 2, 20)); // was rejected before
    expect(ser("20/02/2026")).toBe(iso(2026, 2, 20));
    expect(ser("20.02.2026")).toBe(iso(2026, 2, 20));
    expect(ser("13/4/2026")).toBe(iso(2026, 4, 13)); // 13 can only be the day
    expect(ser("1/15/2026")).toBe(iso(2026, 1, 15)); // 15 can only be the day (US)
  });
  it("refuses to GUESS a genuinely ambiguous numeric date — #AMBIGUOUS!", () => {
    const r = ser("3/4/2026");
    expect(isSolError(r) && r.code).toBe("#AMBIGUOUS!");
    expect(isSolError(ser("04/03/2026")) && (ser("04/03/2026") as { code: string }).code).toBe("#AMBIGUOUS!");
    // equal parts aren't ambiguous (same date either way)
    expect(ser("4/4/2026")).toBe(iso(2026, 4, 4));
    // the NaN-wrapper collapses an ambiguous date to NaN for its plain callers
    expect(parseDateToSerial("3/4/2026")).toBeNaN();
  });
  it("rejects relative expressions (a stored date is a fixed day)", () => {
    expect(ser("next tuesday")).toBeNaN();
    expect(ser("yesterday")).toBeNaN();
    expect(ser("in 3 days")).toBeNaN();
  });
  it("still rejects buried dates and pure garbage", () => {
    expect(ser("call me on 15 March 1996")).toBeNaN();
    expect(ser("garbage")).toBeNaN();
    expect(ser("")).toBeNaN();
  });
});

describe("parseDateToSerial — a year token must be exactly four digits", () => {
  it("a 2-digit year in a numeric date is not a date", () => {
    expect(parseDateToSerial("1/15/26")).toBeNaN();
    expect(parseDateToSerial("1-15-26")).toBeNaN();
    expect(parseDateToSerial("26-01-15")).toBeNaN();
  });
  it("a 2-digit year in a NAMED-MONTH date is not a date either (Frame Input bug)", () => {
    expect(parseDateToSerial("20-Mar-26")).toBeNaN();  // JS would guess 2026
    expect(parseDateToSerial("Mar 20, 26")).toBeNaN();
    expect(parseDateToSerial("Mar 20")).toBeNaN();      // no year at all — JS guesses 2001
  });
  it("named-month forms with a 4-digit year still parse", () => {
    expect(parseDateToSerial("20-Mar-2026")).toBe(jsDateToSerial(new Date(Date.UTC(2026, 2, 20))));
    expect(parseDateToSerial("Mar 20, 2026")).toBe(jsDateToSerial(new Date(Date.UTC(2026, 2, 20))));
  });
  it("a 4-digit year still parses", () => {
    expect(parseDateToSerial("1/15/2026")).toBe(jsDateToSerial(new Date(Date.UTC(2026, 0, 15))));
    // "0026" is a 4-digit token → 26 AD. (Date.UTC(26,…) would remap to 1926, so
    // build the year-26 reference with setUTCFullYear, which does not remap.)
    const y26 = new Date(Date.UTC(2026, 0, 15)); y26.setUTCFullYear(26);
    expect(parseDateToSerial("0026-01-15")).toBe(jsDateToSerial(y26));
  });
});

// parseDateToSerial's timezone independence (zone-less text as UTC wall-clock, a
// zone designator as an absolute instant, date-only as an integer serial) is pinned
// by the "parseDateToSerial is timezone-independent (v1.0 audit P0-1)" describe
// below, which actually drives process.env.TZ across zones — the only way the
// claim can fail for the reason it states.

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

describe("DATEDIF ops (merged into the DateDiff family)", () => {
  const diff = (op: DateDiffOp, s: number, e: number) =>
    new DateDiffNode({ op }).data({ start: [s], end: [e] }).result;

  it("years counts complete years (DATEDIF Y)", () => {
    expect(diff("years", ser(2020, 5, 10), ser(2024, 5, 9))).toBe(3);
    expect(diff("years", ser(2020, 5, 10), ser(2024, 5, 10))).toBe(4);
  });

  it("months counts complete months (DATEDIF M)", () => {
    expect(diff("months", ser(2024, 1, 31), ser(2024, 2, 28))).toBe(0);
    expect(diff("months", ser(2024, 1, 15), ser(2024, 3, 15))).toBe(2);
    expect(diff("months", ser(2020, 5, 10), ser(2024, 3, 9))).toBe(45);
  });

  it("days counts days (DATEDIF D ≡ DAYS — the duplicate op was deleted in the merge)", () => {
    expect(diff("days", ser(2024, 1, 1), ser(2024, 12, 31))).toBe(365); // leap year
    expect(diff("days", ser(2023, 1, 1), ser(2023, 12, 31))).toBe(364);
  });

  it("md matches Excel where Excel is well-defined", () => {
    // Same-or-later day in the month: plain difference.
    expect(diff("md", ser(2024, 5, 10), ser(2024, 8, 15))).toBe(5);
    // The regression the outside review caught: borrow from the month before
    // the end month. Excel returns 28 here; the unclamped Date.UTC rollover
    // construct gave 26.
    expect(diff("md", ser(2024, 1, 31), ser(2024, 2, 28))).toBe(28);
    // Borrow across a leap February (29 days in the month before March).
    expect(diff("md", ser(2024, 1, 15), ser(2024, 3, 10))).toBe(24);
    // Non-leap February borrow.
    expect(diff("md", ser(2023, 1, 15), ser(2023, 3, 10))).toBe(23);
  });

  it("ym counts months ignoring years", () => {
    expect(diff("ym", ser(2020, 5, 10), ser(2024, 3, 9))).toBe(9);
    expect(diff("ym", ser(2024, 1, 15), ser(2024, 3, 15))).toBe(2);
  });

  it("yd counts days ignoring years", () => {
    expect(diff("yd", ser(2024, 1, 10), ser(2024, 3, 15))).toBe(65); // leap Feb
    expect(diff("yd", ser(2023, 3, 1), ser(2024, 2, 1))).toBe(337);
  });

  it("equal dates are 0 in every op", () => {
    const d = ser(2024, 6, 12);
    for (const op of ["years", "months", "days", "md", "ym", "yd"] as const) {
      expect(diff(op, d, d)).toBe(0);
    }
  });

  it("start after end: DATEDIF ops null, DAYS stays signed", () => {
    expect(diff("years", ser(2024, 2, 1), ser(2024, 1, 1))).toBeNull();
    expect(diff("md", ser(2024, 2, 1), ser(2024, 1, 1))).toBeNull();
    expect(diff("days", ser(2024, 1, 31), ser(2024, 1, 1))).toBe(-30);
  });

  it("the basis input exists exactly for the day-count ops that use it", () => {
    expect(new DateDiffNode({ op: "days360" }).inputs.basis).toBeTruthy();
    expect(new DateDiffNode({ op: "yearfrac" }).inputs.basis).toBeTruthy();
    expect(new DateDiffNode({ op: "days" }).inputs.basis).toBeUndefined();
    expect(new DateDiffNode({ op: "years" }).inputs.basis).toBeUndefined();
    // syncBasisInput follows an op change in both directions.
    const n = new DateDiffNode({ op: "yearfrac" });
    n.op = "months";
    expect(n.syncBasisInput()).toBe(true);
    expect(n.inputs.basis).toBeUndefined();
    n.op = "days360";
    expect(n.syncBasisInput()).toBe(true);
    expect(n.inputs.basis).toBeTruthy();
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
    const n = new DateTimeValueNode({ op: "time" });
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

describe("DATEVALUE / TIMEVALUE — one node, op-switch mechanics", () => {
  const parse = (op: "date" | "time", text: string) => {
    const n = new DateTimeValueNode({ op });
    n.stringLiterals.text = text;
    return n.data({}).result;
  };
  const outType = (n: DateTimeValueNode) => {
    const s = n.outputs.result!.socket;
    return s instanceof SolenoidSocket ? s.dataType : undefined;
  };

  it("the same text reads as the whole day or the time of day within it", () => {
    expect(parse("date", "2026-01-03T06:00")).toBe(parseDateToSerial("2026-01-03"));
    expect(parse("time", "2026-01-03T06:00")).toBeCloseTo(0.25, 12);
  });

  it("the switch retypes the output date ↔ number", () => {
    const n = new DateTimeValueNode({ op: "date" });
    expect(outType(n)).toBe("date");
    n.setOp("time");
    expect(outType(n)).toBe("number");
    expect(n.outputs.result!.label).toBe("Time fraction");
    n.setOp("date");
    expect(outType(n)).toBe("date");
    expect(n.outputs.result!.label).toBe("Date");
  });

  it("the text input is the one row either op reads", () => {
    expect(Object.keys(new DateTimeValueNode({ op: "date" }).inputs)).toEqual(["text"]);
    expect(Object.keys(new DateTimeValueNode({ op: "time" }).inputs)).toEqual(["text"]);
  });

  it("blank in → blank out; unparseable text is #VALUE! under either op", () => {
    expect(parse("date", "   ")).toBeNull();
    expect(parse("time", "")).toBeNull();
    for (const op of ["date", "time"] as const) {
      const r = parse(op, "not a date");
      if (!isSolError(r)) throw new Error(`expected SolError for ${op}`);
      expect(r.code).toBe("#VALUE!");
    }
  });
});

// ─── Date nodes are element-wise (the 2026-07-25 combo pass) ──────────────────
// The date family used rigid scalar sockets while every numeric node took
// scalar-or-list. These now declare `datecombo`/`numlist` and broadcast, so a list
// of dates flows through DatePart/WeekInfo/DateDiff/DateAdd/DATEDIF/WORKDAY/
// NETWORKDAYS/DATE/TIME the way a list of numbers already flowed through ADD.
describe("date nodes broadcast over lists (scalar-or-list combo sockets)", () => {
  it("a scalar operand still yields a SCALAR — the widening is additive", () => {
    expect(new DatePartNode({ op: "year" }).data({ date: [MON] }).result).toBe(2023);
    expect(new DateDiffNode({ op: "days" }).data({ start: [MON], end: [FRI] }).result).toBe(4);
    expect(typeof new DateAddNode({ op: "edate" }).data({ start: [MON], months: [1] }).result).toBe("number");
  });

  it("a LIST operand yields a list, element-wise", () => {
    expect(new DatePartNode({ op: "day" }).data({ date: [[MON, WED, FRI]] }).result).toEqual([2, 4, 6]);
    expect(new WeekInfoNode({ op: "weekday" }).data({ date: [[MON, FRI]], return_type: [2] }).result).toEqual([1, 5]);
    expect(new DateDiffNode({ op: "days" }).data({ start: [MON], end: [[WED, FRI]] }).result).toEqual([2, 4]);
    expect(new WorkdaysNode({ op: "networkdays" }).data({ start: [MON], end: [[WED, FRI]] }).result).toEqual([3, 5]);
  });

  it("both operands broadcast together, zipped by position", () => {
    expect(new DateDiffNode({ op: "days" }).data({ start: [[MON, MON]], end: [[WED, FRI]] }).result).toEqual([2, 4]);
    expect(new DateConstructNode().data({ year: [[2023, 2024]], month: [1], day: [2] }).result)
      .toEqual([MON, parseDateToSerial("2024-01-02")]);
  });

  it("a CONFIG input stays scalar — a per-element mode is meaningless", () => {
    // return_type / basis / weekend_code select a MODE; holidays is a whole SET
    // consulted for every result, not an element-wise operand.
    const sock = (n: { inputs: Record<string, { socket: unknown } | undefined> }, k: string) => {
      const s = n.inputs[k]?.socket;
      return s instanceof SolenoidSocket ? s.dataType : undefined;
    };
    expect(sock(new WeekInfoNode({ op: "weekday" }), "return_type")).toBe("number");
    const nw = new WorkdaysNode({ op: "networkdays" });
    expect(sock(nw, "weekend_code")).toBe("number");
    expect(sock(nw, "holidays")).toBe("datelist");
    expect(sock(nw, "start")).toBe("datecombo");
    // The holidays SET still applies across a broadcast result.
    expect(nw.data({ start: [MON], end: [[WED, FRI]], holidays: [[WED]] }).result).toEqual([2, 4]);
  });

  it("per-cell errors and nulls follow the broadcast contract", () => {
    // One out-of-range year errors THAT cell only (broadcastErr), not the whole list.
    const r = new DateConstructNode().data({ year: [[2023, 99999]], month: [1], day: [2] }).result as unknown[];
    expect(r[0]).toBe(MON);
    expect(isSolError(r[1])).toBe(true);
    // A wired MISSING short-circuits per cell.
    expect((new DatePartNode({ op: "year" }).data({ date: [[MON, null as never]] }).result as unknown[])[1]).toBeNull();
  });

  it("TIME broadcasts its three operands", () => {
    expect(new TimeConstructNode().data({ hour: [[0, 12]], minute: [0], second: [0] }).result).toEqual([0, 0.5]);
  });
});

describe("Workdays — one node, op-switch mechanics", () => {
  it("the switch swaps Days ↔ End date, keeps the shared rows, retypes the output", () => {
    const n = new WorkdaysNode({ op: "workday" });
    expect(Object.keys(n.inputs)).toEqual(["start", "days", "weekend_code", "holidays"]);
    expect(n.keysDroppedBySwitch("networkdays")).toEqual(["days"]);
    n.setOp("networkdays");
    expect(Object.keys(n.inputs)).toEqual(["start", "end", "weekend_code", "holidays"]);
    expect(n.outputs.result!.label).toBe("Working days");
    n.setOp("workday");
    expect(Object.keys(n.inputs)).toEqual(["start", "days", "weekend_code", "holidays"]);
    expect(n.outputs.result!.label).toBe("Date");
    expect(n.literals.days).toBe(5);
  });
});
