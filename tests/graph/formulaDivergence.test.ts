// [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import { coreFunction } from "./coreFunction";
import { isSolError } from "../../src/graph/errorValue";
import { GCDNode, MathFXNode } from "../../src/graph/nodes/scalar";
import { TextSliceNode, TextFindNode } from "../../src/graph/nodes/text";

// ─── Where Formula.js was wrong ──────────────────────────────────────────────────
// The 2026-06-25 consolidation compared every formula-reachable function against Formula.js and overrode the handful
// where it is wrong, so the function answers as Excel does AND the visual node runs the same kernel. These pin the
// Excel-correct answers.

const call = (name: string, ...args: unknown[]): unknown => {
  const fn = coreFunction(name);
  expect(fn, `${name} should exist`).not.toBeNull();
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
});

describe("BINOM.DIST.RANGE checks its range and stays finite on large trials (FX is wrong)", () => {
  it("Excel's worked examples, a large range, and Excel's domain", () => {
    expect(num(call("BINOM.DIST.RANGE", 60, 0.75, 48))).toBeCloseTo(0.083974967, 9);
    expect(num(call("BINOM.DIST.RANGE", 60, 0.75, 45, 50))).toBeCloseTo(0.523629793, 9);
    expect(num(call("BINOM.DIST.RANGE", 1e5, 0.5, 0, 50000))).toBeCloseTo(0.501261, 5);
    expect(call("BINOM.DIST.RANGE", 10, 0, 0, 3)).toBe(1);
    for (const args of [[10, 0.5, 6, 5], [10, 1.5, 1], [10, 0.5, 11], [1e7, 0.5, 0, 5e6]]) {
      expect((call("BINOM.DIST.RANGE", ...args) as { code?: string }).code).toBe("#DOMAIN!");
    }
  });
});

describe("ACOT, GAMMALN and GAMMALN.PRECISE answer Excel's (FX is wrong)", () => {
  it("ACOT is in (0, π) and the log-gamma of 0 or less is #DOMAIN!, as the Math Function card's", () => {
    expect(num(call("ACOT", -1))).toBeCloseTo(3 * Math.PI / 4, 14);
    expect(num(call("ACOT", 1))).toBeCloseTo(Math.PI / 4, 14);
    expect(call("ACOT", 1e8)).toBe(1e-8);
    expect(call("ACOT", 0)).toBe(Math.PI / 2);
    expect(new MathFXNode({ op: "acot" }).data({ in: [1e8] }).result).toBe(1e-8);
    expect(call("GAMMALN", 1)).toBe(0);
    for (const name of ["GAMMALN", "GAMMALN.PRECISE"]) {
      for (const x of [-3.7, 0]) expect((call(name, x) as { code?: string }).code).toBe("#DOMAIN!");
      expect(call(name, 4.5)).toBe(new MathFXNode({ op: "gammaln" }).data({ in: [4.5] }).result);
    }
    expect((new MathFXNode({ op: "gammaln" }).data({ in: [-3.7] }).result as { code?: string }).code).toBe("#DOMAIN!");
  });
});

describe("BESSELJ, I, K and Y truncate their order and answer #DOMAIN! past a million or below 0 (FX recurs once per order and rounds)", () => {
  it("an infinite order answers #DOMAIN! too, and a negative one as Excel's #NUM!", () => {
    const t = performance.now();
    for (const name of ["BESSELJ", "BESSELI", "BESSELK", "BESSELY"]) {
      expect(call(name, 1, Infinity)).toMatchObject({ code: "#DOMAIN!", message: `${name} takes an order of at most 1,000,000` });
      for (const n of [-Infinity, -1, -1e12]) {
        expect(call(name, 1, n)).toMatchObject({ code: "#DOMAIN!", message: `${name} takes an order of 0 or more` });
      }
      // Text is never an order, numeric or not ([[C10]] socketLattice); Formula.js would read both as numbers.
      for (const n of ["-1e12", "-Infinity"]) expect(call(name, 1, n)).toMatchObject({ code: "#VALUE!", message: `${name} needs a number` });
    }
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("CLEAN reads a number or logical as text and drops codes 0 to 31 only (FX is wrong)", () => {
  it("as Excel, and the Text Transform card's CLEAN is the same function", () => {
    expect(call("CLEAN", 5)).toBe("5");
    expect(call("CLEAN", true)).toBe("TRUE");
    expect(call("CLEAN", "a\u0001b\u001fc\u007f")).toBe("abc\u007f");
  });
});

describe("DB and DDB past a million periods answer #DOMAIN! (FX steps once per period)", () => {
  it("a huge period within the life answers at once; an ordinary one is Formula.js's", () => {
    const t = performance.now();
    for (const name of ["DB", "DDB"]) expect((call(name, 1000, 100, 1e12, 5e11) as { code?: string }).code).toBe("#DOMAIN!");
    expect(performance.now() - t).toBeLessThan(500);
    expect(num(call("DB", 1000, 100, 10, 3))).toBeCloseTo(129.869816, 6);
    expect(typeof call("DB", 1000, 100, 1e7, 2e7)).not.toBe("number");
  });
});

describe("IFS reads its tests as IF does (FX is wrong)", () => {
  it("a text test is #VALUE!, even \"FALSE\" ([[C10]] socketLattice)", () => {
    for (const t of ["FALSE", "text"]) {
      const r = call("IFS", t, 1, true, 2);
      expect(isSolError(r) && r.code).toBe("#VALUE!");
    }
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
});

describe("MIN and MAX read a list without spreading it into a call", () => {
  const long = Array.from({ length: 150_000 }, (_, i) => i);
  it("a list past the argument limit answers", () => {
    expect(call("MIN", long, 7)).toBe(0);
    expect(call("MAX", long)).toBe(149_999);
  });
});

describe("SUM reads a list without spreading it into a call", () => {
  const long = Array.from({ length: 150_000 }, (_, i) => i % 7);
  it("a list past the argument limit answers", () => {
    expect(call("SUM", long)).toBe(449_994);
  });
});

// ─── TEXT-family sweep (B-4b, 2026-07-05): the Excel-correct answers. ───────────

const str = (v: unknown): string => {
  expect(typeof v === "string", `expected a string, got ${JSON.stringify(v)}`).toBe(true);
  return v as string;
};

describe("TEXT — format-code holes patched over FX", () => {
  it("date codes format OUR serial (the audit-29 fix, pinned)", () => {
    expect(str(call("TEXT", 46096, "yyyy-mm-dd"))).toBe("2026-03-15");
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
});

describe("DOLLAR — Excel's negative accounting form is ($…), FX prints $(…)", () => {
  it("negative parens hold the $ inside; positive/rounding unchanged", () => {
    expect(str(call("DOLLAR", -1234.567, 2))).toBe("($1,234.57)");
    expect(str(call("DOLLAR", 1234.567, 2))).toBe("$1,234.57");
    expect(str(call("DOLLAR", 1234.567, -2))).toBe("$1,200");
  });
});

describe("ROUND past a double's precision", () => {
  it("gives the value back when the digits asked for reach past its 15 significant ones", () => {
    expect(call("ROUND", 1 / 3, 20)).toBe(1 / 3);
    expect(call("ROUND", 123456789.123456789, 12)).toBe(123456789.123456789);
    expect(call("ROUND", 1.005, 2)).toBe(1.01);
    expect(call("ROUND", 2.5, 0)).toBe(3);
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

describe("Pass-through stats family holds the Excel value", () => {
  // Formula.js agreed with Excel on this whole family, so its bodies were ported as they were; these pin Excel's
  // references.
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
