// [[C80]] blankArgIsExcelBlank, [[D96]] emptySlotShowsItsValue
import { describe, it, expect } from "vitest";
import { EXCEL_IMPL_META } from "../../src/graph/excelFunctions";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { emptySlotReading, fieldPlaceholder } from "../../src/graph/emptySlots";
import { rolesFrom, setting, required, LEFT_OUT } from "../../src/graph/inputRoles";

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

describe("the highlighter shows an empty slot's reading ([[D96]] emptySlotShowsItsValue)", () => {
  it("as CSS content after the slot's spaces in the editor, and as text when read-only", async () => {
    const { highlightFormula } = await import("../../src/graph/formulaSyntax");
    expect(highlightFormula("POWER(2, )", "editor")).toContain('</span> <span class="fx-ghost" data-ghost="0"></span>');
    expect(highlightFormula("POWER(2,)")).toContain('<span class="fx-ghost-inline">0</span>');
    expect(highlightFormula('TEXTJOIN(",",,"a")')).toContain(">FALSE<");
    expect(highlightFormula('CONCAT("a",,"b")')).not.toContain("fx-ghost");
    expect(highlightFormula("TAKE(m,,2)")).toContain(">all<");
    expect(highlightFormula("IF(c,SUM(1,),)")).toMatch(/SUM.*fx-ghost-inline">0<.*fx-ghost-inline">0</);
    expect(highlightFormula("PI()")).not.toContain("fx-ghost");
    expect(highlightFormula("(a, b)")).not.toContain("fx-ghost");
  });
});

describe("a card's empty setting field shows what it reads as ([[D96]] emptySlotShowsItsValue)", () => {
  it("from its formula twin, its own blank, or its word; data and required fields show nothing", () => {
    const take = rolesFrom("TAKE", { rows: 1 });
    expect(fieldPlaceholder(take.rows, "rows")).toBe("all");
    expect(fieldPlaceholder(rolesFrom("ROUND", { digits: 1 }).digits, "digits")).toBe("0");
    expect(fieldPlaceholder(rolesFrom("TEXTJOIN", { delimiter: 0 }).delimiter, "delimiter")).toBe("");
    expect(fieldPlaceholder(setting(10), "rows")).toBe("10");
    expect(fieldPlaceholder(setting(LEFT_OUT, "end"), "to")).toBe("end");
    expect(fieldPlaceholder(required, "k")).toBeUndefined();
    expect(fieldPlaceholder(undefined, "x")).toBeUndefined();
  });
});
