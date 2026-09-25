// [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import * as FX from "@formulajs/formulajs";
import { resolveExcelFunction } from "../../src/graph/excelFunctions";
import { isSolError } from "../../src/graph/errorValue";
import { GCDNode } from "../../src/graph/nodes/scalar";
import { TextSliceNode, TextFindNode } from "../../src/graph/nodes/text";

// ─── Formula-engine divergence re-sweep (periodic, author-flagged 2026-06-25) ────
// The 2026-06-25 consolidation compared every formula-reachable function (our impl
// vs Formula.js) and OVERRODE the handful where FX is wrong, so `resolveExcelFunction`
// returns the Excel-correct answer AND the visual node calls the SAME impl. Those
// overrides are load-bearing and easy to regress on an FX upgrade or a refactor, so
// this pins them. It doubles as the "re-run the sweep" guard the backlog asks for:
//   • the "Excel-correct" blocks assert OUR result matches Excel (robust — always valid);
//   • the "FX still diverges" tripwires assert FX STILL returns its wrong answer, so an
//     FX upgrade that changes/fixes one trips this test → re-evaluate the override
//     (a judgment call to surface, not a silent regression).
// Recovered from the audit notes (dev-notes "Divergence audit"), since the original
// `_sweep` script was never committed — only referenced.

const call = (name: string, ...args: unknown[]): unknown => {
  const fn = resolveExcelFunction(name);
  expect(fn, `resolveExcelFunction("${name}") should exist`).not.toBeNull();
  return fn!(...args);
};
const num = (v: unknown): number => {
  expect(typeof v === "number", `expected a number, got ${JSON.stringify(v)}`).toBe(true);
  return v as number;
};

describe("ROUND family and POWER share the node's kernels (FX is wrong)", () => {
  it("ROUNDUP reads 0.1 + 0.2 as 0.3, and POWER(0, 0) is 1 like ^ and the Arithmetic node", () => {
    expect(call("ROUNDUP", 0.1 + 0.2, 1)).toBe(0.3);
    expect(call("POWER", 0, 0)).toBe(1);
  });
  it("FX still rounds binary noise up and refuses 0^0 (tripwire)", () => {
    const fx = FX as unknown as Record<string, (...a: number[]) => unknown>;
    expect(fx.ROUNDUP(0.1 + 0.2, 1)).toBe(0.4);
    expect(fx.POWER(0, 0)).toBeInstanceOf(Error);
  });
});

describe("MOD — Excel result takes the DIVISOR's sign (FX is wrong)", () => {
  it("our impl matches Excel across sign combinations", () => {
    expect(num(call("MOD", 10, -3))).toBeCloseTo(-2, 9); // divisor negative → negative
    expect(num(call("MOD", -3, 5))).toBeCloseTo(2, 9);
    expect(num(call("MOD", 3, -5))).toBeCloseTo(-2, 9);
    expect(num(call("MOD", 10, 3))).toBeCloseTo(1, 9);
    expect(isSolError(call("MOD", 5, 0))).toBe(true); // ÷0 → #DIV/0!, not FX's null
  });
  it("FX still has the sign bug (tripwire — re-evaluate the override if this fails)", () => {
    expect((FX as { MOD: (a: number, b: number) => unknown }).MOD(10, -3)).not.toBe(-2);
  });
});

describe("IFS reads its tests as IF does (FX is wrong)", () => {
  it("text counts only as TRUE or FALSE; other text is #VALUE!", () => {
    expect(call("IFS", "FALSE", 1, true, 2)).toBe(2);
    const r = call("IFS", "text", 1, true, 2);
    expect(isSolError(r) && r.code).toBe("#VALUE!");
  });
  it("FX still takes any truthy text as true (tripwire)", () => {
    expect((FX as unknown as { IFS: (...a: unknown[]) => unknown }).IFS("FALSE", 1, true, 2)).toBe(1);
  });
});

describe("QUOTIENT — integer division, truncated toward zero; ÷0 is #DIV/0!", () => {
  it("matches Excel", () => {
    expect(num(call("QUOTIENT", 7, 2))).toBe(3);
    expect(num(call("QUOTIENT", -7, 2))).toBe(-3); // trunc toward zero, not floor
    expect(isSolError(call("QUOTIENT", 5, 0))).toBe(true);
  });
});

describe("ATAN2 — Excel arg order is (x, y) = atan2(y, x); FX swaps them", () => {
  it("our impl uses x-first", () => {
    expect(num(call("ATAN2", 1, 0))).toBeCloseTo(0, 9);          // point (1,0) → 0 rad
    expect(num(call("ATAN2", 0, 1))).toBeCloseTo(Math.PI / 2, 9); // point (0,1) → π/2
    expect(num(call("ATAN2", 1, 1))).toBeCloseTo(Math.PI / 4, 9);
    expect(num(call("ATAN2", -1, 0))).toBeCloseTo(Math.PI, 9);
  });
  it("FX still swaps the args (tripwire)", () => {
    // FX.ATAN2(1,0) computes atan2(1,0)=π/2 instead of Excel's 0.
    expect((FX as { ATAN2: (a: number, b: number) => unknown }).ATAN2(1, 0)).not.toBeCloseTo(0, 6);
  });
});

describe("ROUND — half-AWAY-from-zero (Excel), not JS half-to-even/up", () => {
  it("rounds .5 away from zero on both signs", () => {
    expect(num(call("ROUND", 2.5, 0))).toBe(3);
    expect(num(call("ROUND", -2.5, 0))).toBe(-3); // the distinguishing case (Math.round → -2)
    expect(num(call("ROUND", 0.125, 2))).toBeCloseTo(0.13, 9);
    expect(num(call("ROUND", -0.125, 2))).toBeCloseTo(-0.13, 9);
  });
});

describe("RANK — a value not in the list is #N/A (Excel); FX wrongly returns 0", () => {
  it("descending rank, ties share the lowest; absent value → #N/A", () => {
    expect(num(call("RANK", 3, [1, 2, 3]))).toBe(1); // largest = rank 1
    expect(num(call("RANK", 2, [1, 2, 3]))).toBe(2);
    expect(isSolError(call("RANK", 5, [1, 2, 3]))).toBe(true); // not present
    // RANK.AVG averages a tie's rank band.
    expect(num(call("RANK.AVG", 10, [10, 10, 20]))).toBeCloseTo(2.5, 9);
  });
});

describe("TRIMMEAN — Excel rounds the trimmed count DOWN to a multiple of 2; FX over-trims", () => {
  it("trims floor(n·pct/2) from each end", () => {
    expect(num(call("TRIMMEAN", [1, 2, 3, 4, 5], 0.4))).toBeCloseTo(3, 9);   // trim 1 each end → mean[2,3,4]
    expect(num(call("TRIMMEAN", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.2))).toBeCloseTo(5.5, 9); // trim 1 → mean[2..9]
    expect(isSolError(call("TRIMMEAN", [1, 2], 1))).toBe(true); // trims everything → #DOMAIN!
  });
});

describe("PERCENTRANK — linear interpolation + TRUNCATE to sig digits (Excel); out-of-range #N/A", () => {
  it("interpolates and truncates", () => {
    expect(num(call("PERCENTRANK", [1, 2, 3, 4], 2))).toBeCloseTo(0.333, 9); // pos 1/(4-1)=0.333…
    expect(num(call("PERCENTRANK", [1, 2, 3, 4], 1))).toBeCloseTo(0, 9);
    expect(num(call("PERCENTRANK", [1, 2, 3, 4], 4))).toBeCloseTo(1, 9);
    expect(isSolError(call("PERCENTRANK", [1, 2, 3, 4], 5))).toBe(true); // outside the range
  });
  it("PERCENTRANK.INC and .EXC run the same kernel, so a value outside the data is #N/A", () => {
    for (const name of ["PERCENTRANK.INC", "PERCENTRANK.EXC"]) {
      for (const x of [0, 5]) expect((call(name, [1, 2, 3, 4], x) as { code: string }).code).toBe("#N/A");
    }
    expect(num(call("PERCENTRANK.INC", [1, 2, 3, 4], 3))).toBeCloseTo(0.666, 9);
    expect(num(call("PERCENTRANK.EXC", [1, 2, 3, 4], 3))).toBeCloseTo(0.6, 9);
  });
  it("FX still answers 0 below the data", () => {
    expect(FX.PERCENTRANK.INC([1, 2, 3, 4], 0)).toBe(0);
    expect(FX.PERCENTRANK.EXC([1, 2, 3, 4], 0)).toBe(0);
  });
});

describe("LEFT, RIGHT, FIND and SEARCH refuse a negative count or a start below 1 (Excel)", () => {
  const code = (v: unknown) => (v as { code?: string }).code;
  it("our answers, and the Text Slice and Text Find cards say the same", () => {
    expect(code(call("LEFT", "abc", -1))).toBe("#VALUE!");
    expect(code(call("RIGHT", "abc", -2))).toBe("#VALUE!");
    expect(call("LEFT", "abc", -0.5)).toBe("");
    expect(code(call("FIND", "a", "abc", 0))).toBe("#VALUE!");
    expect(code(call("SEARCH", "A", "abc", -1))).toBe("#VALUE!");
    expect(code(new TextSliceNode({ op: "left" }).data({ text: ["abc"], n: [-1] }).result)).toBe("#VALUE!");
    expect(code(new TextSliceNode({ op: "mid" }).data({ text: ["abc"], start: [0], len: [1] }).result)).toBe("#VALUE!");
    expect(code(new TextFindNode({ op: "find" }).data({ needle: ["a"], haystack: ["abc"], start: [0] }).result)).toBe("#VALUE!");
  });
  it("FX still clamps", () => {
    expect(FX.LEFT("abc", -1)).toBe("");
    expect(FX.FIND("a", "abc", 0)).toBe(1);
  });
});

describe("hex digits are uppercase, as Excel writes them", () => {
  it("our answers", () => {
    expect(call("DEC2HEX", 255)).toBe("FF");
    expect(call("DEC2HEX", -1)).toBe("FFFFFFFFFF");
    expect(call("BIN2HEX", "11111111")).toBe("FF");
    expect(call("OCT2HEX", "377")).toBe("FF");
    expect(call("BASE", 35, 36)).toBe("Z");
    expect(call("BASE", 10, 16, 4)).toBe("000A");
  });
  it("FX still writes lowercase", () => {
    expect(FX.DEC2HEX(255)).toBe("ff");
    expect(FX.BASE(35, 36)).toBe("z");
  });
});

describe("GCD and LCM truncate each value; a negative one is #DOMAIN! (Excel)", () => {
  const code = (v: unknown) => (v as { code?: string }).code;
  it("our answers", () => {
    expect(call("GCD", 4.5, 6.9)).toBe(2);
    expect(call("GCD", [12, 18, 24.7])).toBe(6);
    expect(call("LCM", 4.5, 6)).toBe(12);
    expect(call("LCM", [12, 18, 24.7])).toBe(72);
    expect(call("LCM", 0, 6)).toBe(0);
    expect(code(call("GCD", -4, 6))).toBe("#DOMAIN!");
    expect(code(call("LCM", 2 ** 53, 3))).toBe("#DOMAIN!");
  });
  it("the GCD card answers the same, pair by pair", () => {
    expect(new GCDNode({ op: "gcd" }).data({ a: [[4.5, 24.9]], b: [[6.9, 36]] }).result).toEqual([2, 12]);
    expect(code((new GCDNode({ op: "lcm" }).data({ a: [[-4]], b: [[6]] }).result as unknown[])[0])).toBe("#DOMAIN!");
  });
  it("FX still runs on the raw decimals and takes negatives", () => {
    expect(FX.GCD(4.5, 6.9)).not.toBe(2);
    expect(FX.LCM(4.5, 6)).toBe(27);
    expect(FX.GCD(-4, 6)).toBe(2);
  });
});

describe("MIN and MAX read a list without spreading it into a call", () => {
  const long = Array.from({ length: 150_000 }, (_, i) => i);
  it("a list past the argument limit answers", () => {
    expect(call("MIN", long, 7)).toBe(0);
    expect(call("MAX", long)).toBe(149_999);
  });
  it("they read numbers only, and no numbers is 0, as Formula.js reads them", () => {
    expect(call("MAX", [1, "9", true, 3])).toBe(3);
    expect(call("MIN", ["a"], null)).toBe(0);
    expect(FX.MAX([1, "9", true, 3])).toBe(3);
  });
  it("FX still spreads the list into a call", () => {
    expect(() => FX.MIN(long)).toThrow(RangeError);
    expect(() => FX.MAX(long)).toThrow(RangeError);
  });
});

// ─── TEXT-family sweep (B-4b, 2026-07-05) — same contract as above: "Excel-correct"
// blocks pin OUR result; "FX still …" tripwires pin FX's wrong answer so an FX
// upgrade that fixes one surfaces the override for re-evaluation. ───────────────

const str = (v: unknown): string => {
  expect(typeof v === "string", `expected a string, got ${JSON.stringify(v)}`).toBe(true);
  return v as string;
};
const fx = FX as unknown as Record<string, (...a: unknown[]) => unknown>;

describe("TEXT — format-code holes patched over FX", () => {
  it("a non-numeric text value passes through unchanged (FX throws)", () => {
    expect(str(call("TEXT", "abc", "0.00"))).toBe("abc");
    expect(str(call("TEXT", "", "0.00"))).toBe("");
  });
  it('"@" and "General" render via numberToText (FX rounds "@", zeroes "General")', () => {
    expect(str(call("TEXT", 1234.567, "@"))).toBe("1234.567");
    expect(str(call("TEXT", 0.1 + 0.2, "General"))).toBe("0.3");
  });
  it('pure zero-pad codes actually pad ("00000"; FX drops the pad)', () => {
    expect(str(call("TEXT", 12, "00000"))).toBe("00012");
    expect(str(call("TEXT", -12, "00000"))).toBe("-00012");
    expect(str(call("TEXT", 12.6, "000"))).toBe("013"); // rounds, then pads
  });
  it("scientific codes format as mantissa E+exp (FX emits a plain decimal)", () => {
    expect(str(call("TEXT", 1234567, "0.00E+00"))).toBe("1.23E+06");
    expect(str(call("TEXT", 0.00001234, "0.0E+00"))).toBe("1.2E-05");
  });
  it("plain numeric codes still route to FX (already Excel-correct — drift guards)", () => {
    expect(str(call("TEXT", 1234.567, "#,##0.00"))).toBe("1,234.57");
    expect(str(call("TEXT", 1234.567, "0.00"))).toBe("1234.57");
    expect(str(call("TEXT", 0.285, "0.0%"))).toBe("28.5%");
    expect(str(call("TEXT", 1234.567, "$#,##0.00"))).toBe("$1,234.57");
  });
  it("date codes format OUR serial (the audit-29 fix, pinned)", () => {
    expect(str(call("TEXT", 46096, "yyyy-mm-dd"))).toBe("2026-03-15");
  });
  it("FX still throws on text / drops the zero pad / mangles @ (tripwires)", () => {
    expect(() => fx.TEXT("abc", "0.00")).toThrow();
    expect(fx.TEXT(12, "00000")).not.toBe("00012");
    expect(fx.TEXT(1234.567, "@")).not.toBe("1234.567");
    expect(fx.TEXT(1234567, "0.00E+00")).not.toBe("1.23E+06");
  });
});

describe("number → text in string contexts — numberToText's 15-sig-digit contract, not FX's raw String()", () => {
  it("text functions format a numeric arg cleanly", () => {
    expect(str(call("UPPER", 0.1 + 0.2))).toBe("0.3");
    expect(str(call("LEFT", 0.1 + 0.2, 5))).toBe("0.3");
    expect(str(call("SUBSTITUTE", 0.1 + 0.2, ".", ","))).toBe("0,3");
    expect(str(call("REPT", 1 / 3, 2))).toBe("0.333333333333333".repeat(2));
    expect(str(call("PROPER", true))).toBe("True");
    expect(num(call("FIND", ".", 0.1 + 0.2))).toBe(2);
    expect(num(call("LEN", 0.1 + 0.2))).toBe(3);
    expect(call("EXACT", 0.1 + 0.2, "0.3")).toBe(true);
  });
  it("FX still stringifies raw — 17-digit noise, SUBSTITUTE throws (tripwires)", () => {
    expect(fx.UPPER(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(() => fx.SUBSTITUTE(0.1 + 0.2, ".", ",")).toThrow();
    expect(fx.EXACT(0.1 + 0.2, "0.3")).toBe(false);
  });
});

describe("PROPER, MID, REPT, CHAR, CODE, UNICHAR, UNICODE — the text cards' answers, Excel's answers (FX is wrong)", () => {
  it("PROPER capitalizes after any non-letter", () => {
    expect(call("PROPER", "76BudGet")).toBe("76Budget");
    expect(call("PROPER", "o'neil 2nd")).toBe("O'Neil 2Nd");
  });
  it("MID of length 0 is empty, REPT truncates its count, UNICHAR and UNICODE cover the astral planes", () => {
    expect(call("MID", "abc", 2, 0)).toBe("");
    expect(call("REPT", "ab", 2.9)).toBe("abab");
    expect(call("UNICHAR", 128512)).toBe("😀");
    expect(call("UNICODE", "😀")).toBe(128512);
    expect(call("CHAR", 128512)).toBe("😀");
    expect(call("CODE", "😀")).toBe(128512);
  });
  it("FX still gets them wrong (tripwires)", () => {
    expect(fx.PROPER("76BudGet")).not.toBe("76Budget");
    expect(fx.MID("abc", 2, 0)).toBeInstanceOf(Error);
    expect(() => fx.REPT("ab", 2.9)).toThrow();
    expect(fx.UNICHAR(128512)).not.toBe("😀");
    expect(fx.UNICODE("😀")).not.toBe(128512);
    expect(fx.CHAR(128512)).not.toBe("😀");
    expect(fx.CODE("😀")).not.toBe(128512);
  });
});

describe("VALUE — strict like Excel: unparseable text is #VALUE!, not FX's silent 0", () => {
  it("parses numbers, $, thousands commas, %, (parens) negative", () => {
    expect(num(call("VALUE", "1,234.57"))).toBeCloseTo(1234.57, 9);
    expect(num(call("VALUE", "$1,000"))).toBe(1000);
    expect(num(call("VALUE", "50%"))).toBeCloseTo(0.5, 9);
    expect(num(call("VALUE", "(5)"))).toBe(-5);
    expect(num(call("VALUE", " 12 "))).toBe(12);
  });
  it("rejects what Excel rejects", () => {
    expect(isSolError(call("VALUE", "abc"))).toBe(true);
    expect(isSolError(call("VALUE", ""))).toBe(true);
    expect(isSolError(call("VALUE", true))).toBe(true); // Excel: VALUE(TRUE) is #VALUE!
    expect(isSolError(call("VALUE", "0x1F"))).toBe(true); // JS Number() would read 31
  });
  it("FX still returns 0 for garbage (tripwire)", () => {
    expect(fx.VALUE("abc")).toBe(0);
  });
});

describe("NUMBERVALUE — custom separators (FX nulls out on a bare decimal-sep arg)", () => {
  it("Excel's documented cases", () => {
    expect(num(call("NUMBERVALUE", "2.500,27", ",", "."))).toBeCloseTo(2500.27, 9);
    expect(num(call("NUMBERVALUE", "3,5%", ","))).toBeCloseTo(0.035, 9);  // group default yields
    expect(num(call("NUMBERVALUE", "3%%"))).toBeCloseTo(0.0003, 9);       // each % divides by 100
    expect(num(call("NUMBERVALUE", ""))).toBe(0);
    expect(num(call("NUMBERVALUE", " 1 000 ", ".", " ") as number)).toBe(1000);
  });
  it("rejects explicit identical separators and a group sep after the decimal", () => {
    expect(isSolError(call("NUMBERVALUE", "1,5", ",", ","))).toBe(true);
    expect(isSolError(call("NUMBERVALUE", "3.1,2", ".", ","))).toBe(true);
  });
  it("FX still NaNs out (tripwire)", () => {
    expect(fx.NUMBERVALUE("3,5%", ",")).toBeNaN();
  });
});

describe("DOLLAR — Excel's negative accounting form is ($…), FX prints $(…)", () => {
  it("negative parens hold the $ inside; positive/rounding unchanged", () => {
    expect(str(call("DOLLAR", -1234.567, 2))).toBe("($1,234.57)");
    expect(str(call("DOLLAR", 1234.567, 2))).toBe("$1,234.57");
    expect(str(call("DOLLAR", 1234.567, -2))).toBe("$1,200");
  });
  it("FX still leads with $( (tripwire)", () => {
    expect(str(fx.DOLLAR(-1234.567, 2)).startsWith("$(")).toBe(true);
  });
});

describe("FIXED and DOLLAR round with roundDigits, as ROUND does", () => {
  it("1.005 to 2 places is 1.01, where Formula.js's toFixed gives 1.00", () => {
    expect(str(call("FIXED", 1.005, 2))).toBe("1.01");
    expect(str(call("FIXED", -1.005, 2))).toBe("-1.01");
    expect(str(call("DOLLAR", 1.005, 2))).toBe("$1.01");
    expect(str(call("FIXED", 1234.5, -1))).toBe("1,230");
    expect(str(call("FIXED", 1.25))).toBe("1.25");
    expect(str(call("FIXED", 2.675, 2.9))).toBe("2.68");
    expect(str((FX as unknown as Record<string, (...a: number[]) => unknown>).FIXED(1.005, 2))).toBe("1.00"); // the Formula.js tripwire
  });
});

describe("FIXED — drift guards, incl. half-away rounding", () => {
  it("decimals, negative decimals, no_commas, signed halves", () => {
    expect(str(call("FIXED", 1234.567, 1))).toBe("1,234.6");
    expect(str(call("FIXED", 1234.567, 1, true))).toBe("1234.6");
    expect(str(call("FIXED", 2.5, 0))).toBe("3");
    expect(str(call("FIXED", -2.5, 0))).toBe("-3");
  });
});

describe("Pass-through stats family holds the Excel value (catches FX drift on upgrade)", () => {
  // These have NO internal override — resolveExcelFunction returns FX directly — so
  // pinning HARDCODED Excel references (not comparing FX to itself) is what actually
  // guards them: a future FX upgrade that shifts one of these to a wrong value trips
  // the sweep. The audit found this whole family already AGREES with Excel today.
  it("MEDIAN / GEOMEAN / HARMEAN / AVEDEV / DEVSQ / SUMSQ match Excel", () => {
    expect(num(call("MEDIAN", [1, 2, 3, 4]))).toBeCloseTo(2.5, 9);
    expect(num(call("MEDIAN", [3, 1, 4, 1, 5, 9, 2, 6]))).toBeCloseTo(3.5, 9);
    expect(num(call("GEOMEAN", [1, 4]))).toBeCloseTo(2, 9);       // √(1·4)
    expect(num(call("HARMEAN", [1, 4]))).toBeCloseTo(1.6, 9);     // 2 / (1 + 1/4)
    expect(num(call("AVEDEV", [1, 2, 3]))).toBeCloseTo(2 / 3, 9); // mean |x−2|
    expect(num(call("DEVSQ", [1, 2, 3]))).toBeCloseTo(2, 9);      // Σ(x−2)²
    expect(num(call("SUMSQ", [1, 2, 3]))).toBeCloseTo(14, 9);     // 1+4+9
  });
});
