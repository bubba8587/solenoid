import { describe, it, expect } from "vitest";
import { TIMESAVER_FORMULAS } from "./timesavers";
import { auditFormulaPack, entryByType, evalFormula } from "./formulaTestKit";
import { ReverseTextNode, SpellNumberNode, spellNumber } from "../nodes/text";
import { jsDateToSerial } from "../nodes/date";
import { isSolError } from "../errorValue";

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
