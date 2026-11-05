// [[C80]] blankArgIsExcelBlank, [[D96]] emptySlotShowsItsValue, [[input-roles#Empty slots]], [[input-roles#Placeholders]], [[formula-language#Blank and omitted arguments]], [[formula-language#Editor support]]
import { describe, it, expect } from "vitest";
import { FUNCTION_ARITY } from "../../src/graph/excelFunctions";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { emptySlotReading, emptyFieldShown } from "../../src/graph/emptySlots";
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
    for (const [name, arity] of Object.entries(FUNCTION_ARITY)) {
      const n = Math.min(Math.max(arity[0], 2), arity[1], 4);
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

    expect(ev('TEXTJOIN(",", , "a", "", "b")')).toBe("a,b");
    expect((ev("XLOOKUP(9, a, b, )", { a: [1, 2, 3], b: [10, 20, 30] }) as { code?: string }).code).toBe("#N/A");
  });

  it("shows the reading, or a bracketed word for a left-out default, and nothing for blank text", () => {
    expect(emptySlotReading("POWER", 1).shown).toBe("0");
    expect(emptySlotReading("CONCAT", 1).shown).toBeNull();
    expect(emptySlotReading("TEXTJOIN", 1).shown).toBe("TRUE");
    expect(emptySlotReading("XLOOKUP", 3).shown).toBe("[none]");
    expect(emptySlotReading("TAKE", 1).shown).toBe("[all]");
  });
});

describe("the editor shows an empty slot's reading; a read-only formula shows it as typed ([[D96]] emptySlotShowsItsValue)", () => {
  it("as CSS content after the slot's spaces while editing, and nothing when read-only", async () => {
    const { highlightFormula } = await import("../../src/graph/formulaSyntax");
    expect(highlightFormula("POWER(2, )", "editor")).toContain('</span> <span class="fx-ghost" data-ghost="0"></span>');
    expect(highlightFormula('TEXTJOIN(",",,"a")', "editor")).toContain('data-ghost="TRUE"');
    expect(highlightFormula('CONCAT("a",,"b")', "editor")).not.toContain("fx-ghost");
    expect(highlightFormula("TAKE(m,,2)", "editor")).toContain('data-ghost="[all]"');
    expect(highlightFormula("IF(c,SUM(1,),)", "editor")).toMatch(/SUM.*data-ghost="0".*data-ghost="0"/);
    expect(highlightFormula("(a, b)", "editor")).not.toContain("fx-ghost");
    expect(highlightFormula("POWER(2, )")).not.toContain("fx-ghost");
  });

  it("F() on a function that needs an argument is one empty slot; PI() takes none", async () => {
    const { highlightFormula } = await import("../../src/graph/formulaSyntax");
    expect(highlightFormula("SQRT()", "editor")).toContain('data-ghost="0"');
    expect(highlightFormula("PI()", "editor")).not.toContain("fx-ghost");
    expect(highlightFormula("TODAY()", "editor")).not.toContain("fx-ghost");
    expect(ev("SQRT()")).toBe(0);
    expect(ev("SIN()")).toBe(0);
    expect(ev("ISNUMBER()")).toBe(false);
    expect(ev("ISBLANK()")).toBe(true);
    expect(highlightFormula("ISNUMBER()", "editor")).not.toContain("fx-ghost");
    expect(ev("PI()")).toBeCloseTo(Math.PI, 12);
  });

  it("a slot past a function's last argument has no reading, and the call is #SYNTAX!", async () => {
    const { highlightFormula } = await import("../../src/graph/formulaSyntax");
    expect(highlightFormula("ROUND(2.6, , , )", "editor").match(/fx-ghost/g)).toHaveLength(1);
    expect(show(ev("ROUND(2.6, 1, 3)"))).toBe("#SYNTAX!");
    expect(show(ev("SQRT(4, 5)"))).toBe("#SYNTAX!");
    expect(ev("SUM(1, 2, 3, 4, 5)")).toBe(15);
  });

  it("the core and the editor agree on which functions need an argument and how many they take", async () => {
    const { readFileSync } = await import("node:fs");
    // Registers every pack's functions afresh, whatever an earlier test in this worker left behind.
    const { initPackFormulas } = await import("../../src/graph/formulaExtensions");
    initPackFormulas();
    const { needsArgument } = await import("../../src/graph/emptySlots");
    const { FORMULA_SIGNATURES } = await import("../../src/graph/formulaSignatureTable");
    const { maxArguments } = await import("../../src/graph/emptySlots");
    const table = JSON.parse(readFileSync("crates/solenoid-core/data/call_traits.json", "utf8")) as Record<string, { needsArg?: boolean; maxArgs?: number }>;
    const known = (n: string) => n in FUNCTION_ARITY || n in FORMULA_SIGNATURES;
    const off = Object.keys(table).filter((n) => known(n) && (!!table[n].needsArg !== needsArgument(n) || (table[n].maxArgs ?? Infinity) !== maxArguments(n)));
    expect(off).toEqual([]);
  });
});

describe("a card's empty field shows what it reads as, by its kind ([[D96]] emptySlotShowsItsValue)", () => {
  it("a setting's role: its blank a Fallback, left out a Behavior in brackets, required nothing", () => {
    const take = rolesFrom("TAKE", { rows: 1 });
    expect(emptyFieldShown("TakeNode", "rows", take.rows)).toEqual({ kind: "behavior", shown: "[all]" });
    expect(emptyFieldShown("RoundNNode", "digits", rolesFrom("ROUND", { digits: 1 }).digits)).toEqual({ kind: "fallback", shown: "0" });
    expect(emptyFieldShown("TextJoinNode", "delimiter", rolesFrom("TEXTJOIN", { delimiter: 0 }).delimiter)).toEqual({ kind: "fallback", shown: undefined });
    expect(emptyFieldShown("X", "rows", setting(10))).toEqual({ kind: "fallback", shown: "10" });
    expect(emptyFieldShown("X", "to", setting(LEFT_OUT, "end"))).toEqual({ kind: "behavior", shown: "[end]" });
    expect(emptyFieldShown("X", "k", required)).toEqual({ kind: "required", shown: undefined });
    expect(emptyFieldShown("X", "x", undefined)).toBeUndefined();
  });

  it("the core's declaration: an Example, a Behavior or a Fallback", () => {
    expect(emptyFieldShown("MolarMassNode", "formula", undefined)).toEqual({ kind: "example", shown: "H2O" });
    expect(emptyFieldShown("XLookupNode", "returnColumn", undefined)).toEqual({ kind: "behavior", shown: "[all]" });
    expect(emptyFieldShown("CastNode", "decimal_sep", undefined)).toEqual({ kind: "fallback", shown: "." });
  });
});
