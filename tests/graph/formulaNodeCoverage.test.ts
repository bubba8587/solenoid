// [[B11]], [[node-classes#Formula registrations and op modules]], [[B11]] maximalMerge, [[formula-language#Parity measurement]]
import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { isCategory, isPair } from "../../src/graph/catalogSearch";
import { FUNCTION_ARITY, FRAME_SURFACE_NAMES } from "../../src/graph/excelFunctions";
import { initPackFormulas, packFormulaNames } from "../../src/graph/formulaExtensions";
import { formulaHomes, FORMULA_CARD_HOMES } from "../../src/graph/formulaCards";
import type { CatalogEntry } from "../../src/graph/AddNodeMenu";

// Pack formulas register as in the app.
initPackFormulas();

function catalogTypes(): Set<string> {
  const types = new Set<string>();
  const walk = (es: CatalogEntry[]): void => {
    for (const e of es) {
      if (isCategory(e) || isPair(e)) walk(e.children);
      else types.add(e.type);
    }
  };
  walk(buildCatalog(false));
  return types;
}

describe("formula ↔ card capability parity", () => {
  it("every formula function has a card (an Excel name, an op, its label, or FORMULA_CARD_HOMES)", () => {
    const homes = formulaHomes();
    const uncovered = [...Object.keys(FUNCTION_ARITY), ...packFormulaNames()]
      .map((n) => n.toUpperCase())
      .filter((n) => !(n in FRAME_SURFACE_NAMES) && !homes.has(n));
    expect(uncovered, `Formula functions with no card: give them one, or name the card that does it in FORMULA_CARD_HOMES:\n  ${uncovered.join("\n  ")}`).toEqual([]);
  });

  it("every home names a card that exists", () => {
    const types = catalogTypes();
    const dangling = [...formulaHomes()].filter(([, h]) => !types.has(h.type)).map(([n, h]) => `${n} → ${h.type}`);
    expect(dangling).toEqual([]);
  });

  it("a hand-kept home is only for what the catalog can't place itself", () => {
    const homes = formulaHomes();
    // A hand entry another route already covers is dead weight: the catalog won.
    const shadowed = Object.entries(FORMULA_CARD_HOMES).filter(([n, h]) => homes.get(n) !== h).map(([n]) => n);
    expect(shadowed).toEqual([]);
  });
});
