// [[C76]]
import { describe, it, expect, afterEach } from "vitest";
import { initPackFormulas, advertisedFunctionNames, packFormulaNames, packFormulaSignature } from "../../src/graph/formulaExtensions";
import { packsStore, BUILTIN_PACKS, allPacks } from "../../src/graph/packs";
import { packFunctionNames, isFunctionName } from "../../src/graph/excelFunctions";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { signatureFor } from "../../src/graph/formulaSignatures";
import type { Pack } from "../../src/graph/packs/packShared";

// ─── The pack → formula seam ([[C51]] formulaNaming decision 4) ─────────────────────────────────
// The load-bearing asymmetry, and the reason this isn't just "hide the names":
// RESOLUTION is global, ADVERTISING is active-only. A formula pack node
// serializes as a plain ExpressionNode and reloads with its pack switched off
// ([[C76]] formulaPackDefault), so the functions its formula calls MUST keep
// answering — a deactivated pack that turned saved documents into #NAME? would
// be data loss. Autocomplete, on the other hand, shouldn't teach a name whose
// pack is off.

/** Runs `f` with the chemistry pack (ELEMENT, MOLARMASS) on or off, then puts it back. */
function withChemistry(on: boolean, f: () => void): void {
  const was = packsStore.isActive("chemistry");
  packsStore.setActive("chemistry", on);
  try { f(); } finally { packsStore.setActive("chemistry", was); }
}

describe("pack-contributed formula functions", () => {
  it("COMPUTES while the pack is OFF — a saved graph must not break", () => {
    initPackFormulas();
    withChemistry(false, () => expect(compileEvaluator('ELEMENT("Fe", "number")')!({})).toBe(26));
  });

  it("is NOT advertised while the pack is off, and IS once it is on", () => {
    initPackFormulas();
    withChemistry(false, () => expect(advertisedFunctionNames()).not.toContain("MOLARMASS"));
    withChemistry(true, () => expect(advertisedFunctionNames()).toContain("MOLARMASS"));
  });

  it("never hides a CORE function when a pack toggles", () => {
    initPackFormulas();
    withChemistry(false, () => {
      for (const core of ["SUM", "XLOOKUP", "TEXTSPLIT", "PRICE"]) expect(advertisedFunctionNames(), core).toContain(core);
    });
  });

  it("surfaces the pack's argument hint through the editor's signature lookup", () => {
    initPackFormulas();
    expect(packFormulaSignature("MOLARMASS")).toBe("chemical formula — H2O, CuSO4·5H2O");
    expect(signatureFor("molarmass")).toBe("chemical formula — H2O, CuSO4·5H2O");
  });
});

describe("a pack's formulas are the core's pack functions, one to one", () => {
  it("every declared formula is one the core carries as a pack's, and every pack function is declared", () => {
    const declared = allPacks().flatMap((p) => (p.formulas ?? []).map((f) => f.name.toUpperCase()));
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([...packFunctionNames()].sort());
    for (const name of declared) expect(isFunctionName(name), name).toBe(true);
  });
});

const FIXTURE: Pack = {
  id: "test-formula-pack",
  name: "Test Formula Pack",
  description: "Fixture for the formula seam.",
  builtin: true,
  defaultActive: false,
  formulas: [{ name: "TESTPACKDOUBLE", arity: [1, 1], signature: "x" }],
};

describe("name collisions fail loudly at startup", () => {
  const added: Pack[] = [];
  const add = (p: Pack) => { added.push(p); BUILTIN_PACKS.push(p); };
  afterEach(() => {
    for (const p of added) BUILTIN_PACKS.splice(BUILTIN_PACKS.indexOf(p), 1);
    added.length = 0;
    initPackFormulas();
  });

  it("rejects two packs claiming the same name", () => {
    add({ ...FIXTURE, id: "test-collide-a" });
    add({ ...FIXTURE, id: "test-collide-b" });
    expect(() => initPackFormulas()).toThrow(/already claimed by pack/);
  });
});

describe("re-running init is safe", () => {
  it("does not reject its own previous registrations", () => {
    BUILTIN_PACKS.push(FIXTURE);
    try {
      expect(() => { initPackFormulas(); initPackFormulas(); initPackFormulas(); }).not.toThrow();
      expect(packFormulaNames()).toContain("TESTPACKDOUBLE");
    } finally {
      BUILTIN_PACKS.splice(BUILTIN_PACKS.indexOf(FIXTURE), 1);
      initPackFormulas();
    }
  });

  it("a pack that is no longer present stops being declared", () => {
    BUILTIN_PACKS.push(FIXTURE);
    initPackFormulas();
    BUILTIN_PACKS.splice(BUILTIN_PACKS.indexOf(FIXTURE), 1);
    initPackFormulas();
    expect(packFormulaNames()).not.toContain("TESTPACKDOUBLE");
  });
});
