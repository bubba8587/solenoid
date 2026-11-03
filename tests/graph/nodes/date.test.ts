// [[C44]], [[B11]]
import { solDate, type SolDate } from "../../../src/graph/dateValue";
import { describe, it, expect, afterEach } from "vitest";
import { DateAddNode, DatePartNode, DateTimeValueNode, DateConstructNode, WorkdaysNode, WeekInfoNode, DateDiffNode, parseDateToSerial, parseDate, serialToJsDate, jsDateToSerial, type DateDiffOp } from "../../../src/graph/nodes/date";
import { isSolError } from "../../../src/graph/errorValue";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { SolenoidSocket } from "../../../src/graph/sockets";

// 2023-01-02 is a Monday; the working week Mon 2 … Fri 6 has no weekend inside it.
const MON = parseDateToSerial("2023-01-02");
const WED = parseDateToSerial("2023-01-04");
const FRI = parseDateToSerial("2023-01-06");

describe("WORKDAY / NETWORKDAYS — optional holidays list (Excel [holidays] parity)", () => {


  it("NETWORKDAYS counts whole days whatever the times of day, as the formula does", () => {
    const n = new WorkdaysNode({ op: "networkdays" });
    expect(n.data({ start: [solDate(MON + 0.5)], end: [solDate(WED + 0.25)] }).result).toBe(3);
    expect(n.data({ start: [solDate(WED + 0.25)], end: [solDate(MON + 0.5)] }).result).toBe(-3);
    expect(compileEvaluator("NETWORKDAYS(s, f)")!({ s: solDate(MON + 0.5), f: solDate(WED + 0.25) })).toBe(3);
  });

  it("an unknown weekend code is #VALUE! on the card, as in WORKDAY.INTL and NETWORKDAYS.INTL", () => {
    for (const op of ["networkdays", "workday"] as const) {
      const n = new WorkdaysNode({ op });
      n.literals.weekend_code = 99;
      const r = n.data({ start: [solDate(MON)], end: [solDate(FRI)], days: [1] }).result;
      expect(isSolError(r) && r.code, op).toBe("#VALUE!");
    }
    expect(isSolError(compileEvaluator("NETWORKDAYS.INTL(s, f, 99)")!({ s: solDate(MON), f: solDate(FRI) }))).toBe(true);
    expect(isSolError(compileEvaluator("WORKDAY.INTL(s, 1, 99)")!({ s: solDate(MON) }))).toBe(true);
  });

});

describe("WORKDAY jumps whole weeks and stays inside the calendar", () => {
  const walk = (start: number, days: number, off: Set<number>, hol: Set<number>) => {
    let d = start, left = Math.abs(days);
    const step = days < 0 ? -1 : 1;
    while (left > 0) { d += step; if (!off.has(serialToJsDate(d).getUTCDay()) && !hol.has(d)) left--; }
    return d;
  };
  it("agrees with a day-by-day walk, holidays included", async () => {
    const { coreFunction } = await import("../coreFunction");
    const intl = coreFunction("WORKDAY.INTL")!;
    const hol = [MON + 3, MON + 10, MON + 11, MON + 40, MON - 9, MON - 30];
    for (const days of [1, 4, 5, 6, 13, 50, 101, -1, -5, -6, -37, -120]) {
      const hd = hol.map(solDate);
      expect(intl(solDate(MON), days, "0000011", hd)).toEqual(solDate(walk(MON, days, new Set([6, 0]), new Set(hol))));
      expect(intl(solDate(MON + 2), days, "0110001", hd)).toEqual(solDate(walk(MON + 2, days, new Set([2, 3, 0]), new Set(hol))));
      expect(new WorkdaysNode({ op: "workday" }).data({ start: [solDate(MON)], days: [days], holidays: [hd] }).result)
        .toEqual(solDate(walk(MON, days, new Set([6, 0]), new Set(hol))));
    }
  });
  it("a count past year 9999 is an error at once, not a frozen walk", async () => {
    const { coreFunction } = await import("../coreFunction");
    for (const f of [() => coreFunction("WORKDAY.INTL")!(solDate(MON), 1e9, "0000011"), () => coreFunction("WORKDAY")!(solDate(MON), -1e9),
      () => new WorkdaysNode({ op: "workday" }).data({ start: [solDate(MON)], days: [1e9] }).result]) {
      const t = Date.now();
      const r = f();
      expect(Date.now() - t).toBeLessThan(500);
      expect(isSolError(r) && r.code).toBe("#DOMAIN!");
    }
  });
});

describe("DATE — numeric year is literal (no century guessing)", () => {
  const yr = (serial: number) => serialToJsDate(serial).getUTCFullYear();
  it("a small year is that literal year, not 1900+year", () => {
    const r = new DateConstructNode().data({ year: [26], month: [1], day: [15] }).result;
    expect(yr((r as unknown as SolDate).__date)).toBe(26); // 26 AD, NOT 1926
  });
  it("a full year round-trips", () => {
    const r = new DateConstructNode().data({ year: [2026], month: [3], day: [15] }).result;
    expect(r).toEqual(solDate(jsDateToSerial(new Date(Date.UTC(2026, 2, 15)))));
  });
});

describe("parseDate — wider formats, day-first, and #AMBIGUOUS!", () => {
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
    new DateDiffNode({ op }).data({ start: [solDate(s)], end: [solDate(e)] }).result;

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
});

describe("EDATE clamps to month end (v1.0 audit finding 11)", () => {
  const edate = (y: number, m: number, d: number, months: number) =>
    new DateAddNode({ op: "edate" }).data({ start: [solDate(ser(y, m, d))], months: [months] }).result;

  it("Jan 31 + 1mo = Feb 28 (not Mar 3)", () => {
    expect(edate(2023, 1, 31, 1)).toEqual(solDate(ser(2023, 2, 28)));
  });
  it("Jan 31 + 1mo = Feb 29 in a leap year", () => {
    expect(edate(2024, 1, 31, 1)).toEqual(solDate(ser(2024, 2, 29)));
  });
  it("Mar 31 - 1mo = Feb 29 in a leap year", () => {
    expect(edate(2024, 3, 31, -1)).toEqual(solDate(ser(2024, 2, 29)));
  });
  it("mid-month days are untouched", () => {
    expect(edate(2024, 1, 15, 1)).toEqual(solDate(ser(2024, 2, 15)));
    expect(edate(2024, 1, 15, 13)).toEqual(solDate(ser(2025, 2, 15)));
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
    expect(parse("date", "2026-01-03T06:00")).toEqual(solDate(parseDateToSerial("2026-01-03")));
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


  it("both operands broadcast together, zipped by position", () => {
    expect(new DateDiffNode({ op: "days" }).data({ start: [[solDate(MON), solDate(MON)]], end: [[solDate(WED), solDate(FRI)]] }).result).toEqual([2, 4]);
    expect(new DateConstructNode().data({ year: [[2023, 2024]], month: [1], day: [2] }).result)
      .toEqual([solDate(MON), solDate(parseDateToSerial("2024-01-02"))]);
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
    expect(nw.data({ start: [solDate(MON)], end: [[solDate(WED), solDate(FRI)]], holidays: [[solDate(WED)]] }).result).toEqual([2, 4]);
  });


});

describe("a date card refuses a plain number where a date goes ([[D114]] dateIsAKind)", () => {
  it("answers #TYPE!, as the formula does", () => {
    for (const n of [new DatePartNode({ op: "year" }), new WeekInfoNode({ op: "weekday" })]) {
      expect(n.data({ date: [MON] }).result, n.label).toMatchObject({ code: "#TYPE!" });
    }
    expect(new DateDiffNode({ op: "days" }).data({ start: [MON], end: [solDate(WED)] }).result).toMatchObject({ code: "#TYPE!" });
    expect(new DateAddNode({ op: "edate" }).data({ start: [MON], months: [1] }).result).toMatchObject({ code: "#TYPE!" });
    expect(new WorkdaysNode({ op: "workday" }).data({ start: [MON], days: [1] }).result).toMatchObject({ code: "#TYPE!" });
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

describe("a clock time reads as the minute it is", () => {
  it("04:00 as a float serial formats as 04:00, not 03:59", async () => {
    const { formatDateSerial } = await import("../../../src/graph/nodes/dateSerial");
    expect(formatDateSerial(46027 + 240 / 1440, "YYYY-MM-DD HH:mm")).toBe("2026-01-05 04:00");
  });
});
