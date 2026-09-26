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
  VDB: "no_switch is not built",
  GROUPBY: "field_headers, total_depth, sort_order, filter_array and field_relationship are not built",
  GROWTH: "const (forcing the fit through b = 1) is not built",
  TREND: "const (forcing the fit through the origin) is not built",
  LINEST: "const and stats are not built",
  LOGEST: "const and stats are not built",
  MAP: "the LAMBDA takes each cell's row and column after up to three arrays' cells, so more arrays would collide",
  TEXTAFTER: "instance_num, match_mode, match_end and if_not_found are not built",
  TEXTBEFORE: "instance_num, match_mode, match_end and if_not_found are not built",
  TEXTSPLIT: "ignore_empty, match_mode and pad_with are not built",
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
