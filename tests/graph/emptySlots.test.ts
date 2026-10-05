// [[C80]] blankArgIsExcelBlank, [[D96]] emptySlotShowsItsValue
import { describe, it, expect } from "vitest";
import { EXCEL_IMPL_META } from "../../src/graph/excelFunctions";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { emptySlotReading } from "../../src/graph/emptySlots";

const ev = (src: string, env: Record<string, unknown> = {}) => compileEvaluator(src)!(env);
const show = (v: unknown): string => {
  if (v && typeof v === "object" && "__solError" in (v as object)) return (v as { code: string }).code;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};
const typed = (v: unknown): string | null =>
  v === undefined ? null : v === "" ? '""' : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" ? String(v) : null;

describe("an empty slot reads as its parameter's Excel blank", () => {
  it("in every function and position, the same as typing the reading out", () => {
    const drift: string[] = [];
    for (const [name, meta] of Object.entries(EXCEL_IMPL_META as Record<string, { arity?: [number, number] }>)) {
      if (!meta.arity) continue;
      const n = Math.min(Math.max(meta.arity[0], 2), meta.arity[1], 4);
      if (n < 2) continue; // F() is no argument, not an empty slot
      for (let i = 0; i < n; i++) {
        const lit = typed(emptySlotReading(name, i).value);
        if (lit === null) continue;
        for (const sample of ["2", '"ab"']) {
          const args = Array.from({ length: n }, () => sample);
          const blank = [...args]; blank[i] = "";
          const filled = [...args]; filled[i] = lit;
          let a: unknown, b: unknown;
          try { a = ev(`${name}(${blank.join(",")})`); } catch { a = "threw"; }
          try { b = ev(`${name}(${filled.join(",")})`); } catch { b = "threw"; }
          if (show(a) !== show(b)) drift.push(`${name} arg ${i + 1} (${sample}): empty ${show(a)}, typed ${lit} ${show(b)}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it("answers Excel's results, and a blank value still follows its role", () => {
    expect(ev("POWER(2, )")).toBe(1);
    expect(ev("IF(TRUE, , 5)")).toBe(0);
    expect(ev("AVERAGE(2, )")).toBe(1);
    expect(ev("AVERAGE(2, b)", { b: null })).toBe(2);
    expect(ev('CONCAT("a", , "b")')).toBe("ab");
    expect(ev('TEXTJOIN(",", , "a", "", "b")')).toBe("a,,b");
  });

  it("shows the reading, or a word for a left-out default, and nothing for blank text", () => {
    expect(emptySlotReading("POWER", 1).shown).toBe("0");
    expect(emptySlotReading("CONCAT", 1).shown).toBeNull();
    expect(emptySlotReading("TEXTJOIN", 1).shown).toBe("FALSE");
    expect(emptySlotReading("TAKE", 1).shown).toBe("all");
  });
});
