import { describe, it, expect } from "vitest";
import { TIMESAVER_FORMULAS } from "../../../src/graph/packs/timesavers";
import { auditFormulaPack, entryByType, evalFormula, evalPackFormula } from "../../../src/graph/packs/formulaTestKit";
import { ReverseTextNode, SpellNumberNode, spellNumber } from "../../../src/graph/nodes/text";
import { jsDateToSerial, serialToJsDate } from "../../../src/graph/nodes/date";
import { isSolError } from "../../../src/graph/errorValue";

const run = (type: string, inputs: Record<string, number | string>) =>
  evalFormula(entryByType(TIMESAVER_FORMULAS, type), inputs);

const ser = (y: number, m: number, d: number) => jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));

describe("Timesavers formula presets", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(TIMESAVER_FORMULAS)).toEqual([]);
  });

  it("percent change and CAGR", () => {
    expect(run("ts-percent-change", { before: 80, after: 100 })).toBeCloseTo(0.25, 9);
    expect(run("ts-percent-change", { before: 100, after: 80 })).toBeCloseTo(-0.2, 9);
    // 100 → 200 over 10 periods ≈ 7.18%/period.
    expect(run("ts-cagr", { startval: 100, endval: 200, periods: 10 })).toBeCloseTo(0.07177, 4);
  });

  it("ordinal suffix (incl. the 11/12/13 special case)", () => {
    expect(run("ts-ordinal", { n: 1 })).toBe("1st");
    expect(run("ts-ordinal", { n: 2 })).toBe("2nd");
    expect(run("ts-ordinal", { n: 23 })).toBe("23rd");
    expect(run("ts-ordinal", { n: 11 })).toBe("11th");
    expect(run("ts-ordinal", { n: 112 })).toBe("112th");
  });

  it("clean whitespace strips NBSP + control chars + outer/multi spaces", () => {
    // NBSP (the web-paste killer) becomes a real space; TRIM strips the ends.
    expect(run("ts-clean-whitespace", { t: "  a\u00A0b  " })).toBe("a b");
    // CLEAN removes control characters outright (Excel semantics).
    expect(run("ts-clean-whitespace", { t: "a\tb" })).toBe("ab");
  });

  it("mask keeps the last N", () => {
    expect(run("ts-mask-last", { t: "4111222233334444", k: 4 })).toBe("************4444");
    expect(run("ts-mask-last", { t: "abc", k: 5 })).toBe("abc"); // shorter than k
  });

  it("count words / occurrences", () => {
    expect(run("ts-count-words", { t: "  the quick brown fox " })).toBe(4);
    expect(run("ts-count-words", { t: "   " })).toBe(0);
    expect(run("ts-count-occurrences", { t: "banana", sub: "an" })).toBe(2);
    expect(run("ts-count-occurrences", { t: "banana", sub: "z" })).toBe(0);
  });

  it("quarter and days-in-month read a date serial (internal serial-aware extractors)", () => {
    expect(run("ts-quarter", { date: ser(2026, 1, 1) })).toBe(1);
    expect(run("ts-quarter", { date: ser(2026, 4, 1) })).toBe(2);
    expect(run("ts-quarter", { date: ser(2026, 7, 15) })).toBe(3);
    expect(run("ts-quarter", { date: ser(2026, 12, 31) })).toBe(4);
    expect(run("ts-days-in-month", { date: ser(2024, 2, 10) })).toBe(29); // leap February
    expect(run("ts-days-in-month", { date: ser(2026, 2, 10) })).toBe(28);
    expect(run("ts-days-in-month", { date: ser(2026, 4, 10) })).toBe(30);
    expect(run("ts-days-in-month", { date: ser(2026, 7, 10) })).toBe(31);
  });
});

describe("Timesaver date idioms with config (C5)", () => {
  const weekdayOf = (serial: number) => serialToJsDate(serial).getUTCDay(); // 0=Sun … 6=Sat
  const domOf = (serial: number) => serialToJsDate(serial).getUTCDate();

  it("Fiscal Quarter: start defaults to 1 (calendar); a fiscal start shifts the quarters", () => {
    // Untouched (start seeded 1) === the calendar behaviour the existing test pins.
    expect(run("ts-quarter", { date: ser(2026, 4, 1) })).toBe(2);
    // April fiscal year (start=4): April is Q1, March is Q4, July is Q2.
    expect(run("ts-quarter", { date: ser(2026, 4, 1), start: 4 })).toBe(1);
    expect(run("ts-quarter", { date: ser(2026, 3, 31), start: 4 })).toBe(4);
    expect(run("ts-quarter", { date: ser(2026, 7, 1), start: 4 })).toBe(2);
    // July fiscal year (start=7): January falls in Q3.
    expect(run("ts-quarter", { date: ser(2026, 1, 15), start: 7 })).toBe(3);
  });

  it("Age: the DATEDIF Y/YM/MD pieces against real-Excel goldens + the composed text", () => {
    // 15 Jan 1990 → 20 Mar 2020 = 30y 2m 5d (Excel DATEDIF Y / YM / MD).
    const dob = ser(1990, 1, 15), end = ser(2020, 3, 20);
    expect(evalPackFormula('DATEDIF(dob,end,"Y")', { dob, end })).toBe(30);
    expect(evalPackFormula('DATEDIF(dob,end,"YM")', { dob, end })).toBe(2);
    expect(evalPackFormula('DATEDIF(dob,end,"MD")', { dob, end })).toBe(5);
    // The preset's exact composition, with a fixed end standing in for TODAY().
    expect(evalPackFormula(
      'DATEDIF(dob,end,"Y")&"y "&DATEDIF(dob,end,"YM")&"m "&DATEDIF(dob,end,"MD")&"d"',
      { dob, end },
    )).toBe("30y 2m 5d");
    // The documented MD edge (31 Jan → 1 Mar, a whole February skipped): Excel is
    // unreliable, Solenoid's borrow is deterministic — pin OUR value (parity: false).
    expect(evalPackFormula('DATEDIF(a,b,"MD")', { a: ser(2024, 1, 31), b: ser(2024, 3, 1) })).toBe(-1);
  });

  it("Nth Weekday: default is the 2nd Tuesday; n and weekday select the occurrence", () => {
    // Default seeds (n=2, weekday=3=Tuesday): a Tuesday in the 2nd week (day 8–14).
    const d = run("ts-nth-weekday", { date: ser(2026, 9, 20) }) as number;
    expect(weekdayOf(d)).toBe(2); // getUTCDay 2 = Tuesday
    expect(domOf(d)).toBeGreaterThanOrEqual(8);
    expect(domOf(d)).toBeLessThanOrEqual(14);
    // 1st Monday (n=1, weekday=2): a Monday in days 1–7.
    const m = run("ts-nth-weekday", { date: ser(2026, 9, 10), n: 1, weekday: 2 }) as number;
    expect(weekdayOf(m)).toBe(1);
    expect(domOf(m)).toBeGreaterThanOrEqual(1);
    expect(domOf(m)).toBeLessThanOrEqual(7);
    // 3rd Saturday — exercises the +7 wrap when the wanted weekday precedes the 1st's.
    const s = run("ts-nth-weekday", { date: ser(2026, 2, 1), n: 3, weekday: 7 }) as number;
    expect(weekdayOf(s)).toBe(6); // Saturday
    expect(domOf(s)).toBeGreaterThanOrEqual(15);
    expect(domOf(s)).toBeLessThanOrEqual(21);
  });
});

describe("Reverse Text node", () => {
  it("reverses, keeping surrogate pairs whole", () => {
    expect(new ReverseTextNode().data({ text: ["hello"] }).result).toBe("olleh");
    expect(new ReverseTextNode().data({ text: ["a💡b"] }).result).toBe("b💡a");
    expect(new ReverseTextNode().data({ text: [""] }).result).toBe("");
  });
});

describe("Spell Number", () => {
  it("cardinals, teens, hyphens, hundreds", () => {
    expect(spellNumber(0)).toBe("zero");
    expect(spellNumber(13)).toBe("thirteen");
    expect(spellNumber(21)).toBe("twenty-one");
    expect(spellNumber(105)).toBe("one hundred five");
    expect(spellNumber(999)).toBe("nine hundred ninety-nine");
  });

  it("scales up to trillions, with gaps", () => {
    expect(spellNumber(1234)).toBe("one thousand two hundred thirty-four");
    expect(spellNumber(1000000)).toBe("one million");
    expect(spellNumber(2000001)).toBe("two million one");
    expect(spellNumber(1.5e12)).toBe("one trillion five hundred billion");
  });

  it("negatives and decimals", () => {
    expect(spellNumber(-42)).toBe("negative forty-two");
    expect(spellNumber(3.14)).toBe("three point one four");
  });

  it("out of range → #DOMAIN!", () => {
    expect(isSolError(spellNumber(1e15))).toBe(true);
    expect(isSolError(spellNumber(Infinity))).toBe(true);
  });

  it("node reads wired value or literal", () => {
    const n = new SpellNumberNode();
    expect(n.data({ value: [7] }).result).toBe("seven");
    n.literals.value = 12;
    expect(n.data({}).result).toBe("twelve");
  });
});
