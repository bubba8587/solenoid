// [[A5]] excelParity
import { describe, it, expect } from "vitest";
import { EXCEL_IMPL_META } from "../../src/graph/excelFunctions";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { EXCEL_ARITY, MANY } from "./fixtures/excelArity";

// A registration that accepts fewer arguments than Excel's, each with the reason it stays short. The test fails on a new
// gap and on an entry that no longer applies, so the list only shrinks.
const KNOWN_SHORT: Record<string, string> = {
  PRICE: "no day-count basis argument yet",
  YIELD: "no day-count basis argument yet",
  ODDFPRICE: "no day-count basis argument yet",
  ODDFYIELD: "no day-count basis argument yet",
  ODDLPRICE: "no day-count basis argument yet",
  ODDLYIELD: "no day-count basis argument yet",
  GROUPBY: "field_headers, total_depth, sort_order, filter_array and field_relationship are not built",
  LINEST: "answers [slope, intercept, R²], not Excel's row; const and stats wait on that shape",
  LOGEST: "answers [m, b] as a list; const and stats wait on the same call as LINEST",
  MAP: "the LAMBDA takes each cell's row and column after up to three arrays' cells, so more arrays would collide",
};

const gaps = (): string[] => {
  const out: string[] = [];
  for (const [name, [min, max]] of Object.entries(EXCEL_ARITY)) {
    const meta = EXCEL_IMPL_META[name];
    if (!meta) continue;
    const [ourMin, ourMax] = meta.arity;
    const maxOk = max === MANY ? ourMax >= 250 : ourMax >= max;
    if (ourMin > min || !maxOk) out.push(`${name}: ours [${ourMin}, ${ourMax}], Excel's [${min}, ${max === MANY ? "many" : max}]`);
  }
  return out;
};

describe("[[A5]] excelParity: every registration accepts every argument Excel's does", () => {
  it("the reference covers every registered Excel name it lists", () => {
    const missing = Object.keys(EXCEL_ARITY).filter((n) => !EXCEL_IMPL_META[n]);
    expect(missing, "a name in the reference that nothing registers: drop it or register the function").toEqual([]);
  });

  it("no registration is shorter than Excel's signature, apart from the known list", () => {
    const found = gaps();
    const unexplained = found.filter((g) => !(g.split(":")[0] in KNOWN_SHORT));
    const stale = Object.keys(KNOWN_SHORT).filter((n) => !found.some((g) => g.startsWith(`${n}:`)));
    expect(unexplained, "short of Excel's signature: add the arguments, or list the name with its reason").toEqual([]);
    expect(stale, "listed as short but no longer is: remove the entry").toEqual([]);
  });
});

describe("widened to Excel's signature", () => {
  it("MODE.MULT pools several ranges, as Excel's number1, number2, … do", () => {
    expect(compileEvaluator("MODE.MULT(a, b)")!({ a: [1, 2, 2], b: [3, 3, 1] })).toEqual([1, 2, 3]);
  });
});

describe("TEXTSPLIT, TEXTAFTER and TEXTBEFORE take Excel's options", () => {
  const ev = (e: string, env: Record<string, unknown> = {}) => compileEvaluator(e)!(env);
  it("TEXTAFTER / TEXTBEFORE: instance from either end, match_mode, match_end, if_not_found", () => {
    const t = "a-b-C-d";
    expect(ev("TEXTAFTER(t, \"-\", 2)", { t })).toBe("C-d");
    expect(ev("TEXTAFTER(t, \"-\", -1)", { t })).toBe("d");
    expect(ev("TEXTBEFORE(t, \"-\", -2)", { t })).toBe("a-b");
    expect(ev("TEXTBEFORE(t, \"c\", 1, 1)", { t })).toBe("a-b-");
    expect(ev("TEXTBEFORE(t, \"c\")", { t })).toBeNull();
    expect(ev("TEXTAFTER(t, \"-\", 4)", { t })).toBeNull();
    expect(ev("TEXTBEFORE(t, \"-\", 4, 0, 1)", { t })).toBe("a-b-C-d");
    expect(ev("TEXTAFTER(t, \"x\", 1, 0, 0, \"none\")", { t })).toBe("none");
    expect(ev("TEXTAFTER(t, \"-\", 0)", { t })).toMatchObject({ code: "#VALUE!" });
  });
  it("TEXTSPLIT: a row delimiter answers a table padded with #N/A; ignore_empty drops empty parts", () => {
    expect(ev("TEXTSPLIT(t, \",\")", { t: "a,,b" })).toEqual(["a", "", "b"]);
    expect(ev("TEXTSPLIT(t, \",\", , TRUE)", { t: "a,,b" })).toEqual(["a", "b"]);
    const m = ev("TEXTSPLIT(t, \",\", \";\")", { t: "a,b;c" }) as unknown[][];
    expect([m[0], m[1][0]]).toEqual([["a", "b"], "c"]);
    expect((m[1][1] as { code: string }).code).toBe("#N/A");
    expect(ev("TEXTSPLIT(t, \",\", \";\", FALSE, 0, \"-\")", { t: "a,b;c" })).toEqual([["a", "b"], ["c", "-"]]);
    expect(ev("TEXTSPLIT(t, \"X\", , , 1)", { t: "axb" })).toEqual(["a", "b"]);
  });
});

describe("VDB's no_switch", () => {
  it("stays on declining balance instead of switching to straight-line", () => {
    const ev = (e: string) => compileEvaluator(e)!({});
    expect(ev("VDB(1000, 0, 5, 4, 5, 2)")).toBeCloseTo(108, 6);
    expect(ev("VDB(1000, 0, 5, 4, 5, 2, TRUE)")).toBeCloseTo(51.84, 6);
    expect(ev("VDB(1000, 0, 5, 0, 1, 2, TRUE)")).toBeCloseTo(400, 6);
  });
});

describe("TREND and GROWTH's const", () => {
  it("FALSE forces b = 0 for TREND and b = 1 for GROWTH", () => {
    const ev = (e: string, env: Record<string, unknown>) => compileEvaluator(e)!(env);
    const xs = [1, 2, 3], ys = [2, 4, 7];
    expect(ev("TREND(y, x, n, FALSE)", { y: ys, x: xs, n: [4] }) as number[]).toEqual([(31 / 14) * 4].map((v) => expect.closeTo(v, 9)));
    expect((ev("TREND(y, x, n)", { y: ys, x: xs, n: [0] }) as number[])[0]).toBeCloseTo(-2 / 3, 9);
    const g = ev("GROWTH(y, x, n, FALSE)", { y: [2, 4, 8], x: xs, n: [4] }) as number[];
    expect(g[0]).toBeCloseTo(Math.exp(((Math.log(2) + 2 * Math.log(4) + 3 * Math.log(8)) / 14) * 4), 9);
  });
});
