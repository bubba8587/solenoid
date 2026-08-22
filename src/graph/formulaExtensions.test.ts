import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initPackFormulas, advertisedFunctionNames, packFormulaNames, packFormulaSignature } from "./formulaExtensions";
import { packsStore, BUILTIN_PACKS } from "./packs";
import { resolveExcelFunction } from "./excelFunctions";
import { compileEvaluator } from "./excelFormula";
import { signatureFor } from "./formulaSignatures";
import type { Pack } from "./packs/packShared";

// ─── The pack → formula seam (formulaNaming decision 4) ─────────────────────────────────
// The load-bearing asymmetry, and the reason this isn't just "hide the names":
// RESOLUTION is global, ADVERTISING is active-only. A formula pack node
// serializes as a plain ExpressionNode and reloads with its pack switched off
// (docs/pack-architecture.md), so the functions its formula calls MUST keep
// answering — a deactivated pack that turned saved documents into #NAME? would
// be data loss. Autocomplete, on the other hand, shouldn't teach a name whose
// pack is off.

const FIXTURE: Pack = {
  id: "test-formula-pack",
  name: "Test Formula Pack",
  description: "Fixture for the formula seam.",
  builtin: true,
  defaultActive: false,
  formulas: [
    { name: "TESTPACKDOUBLE", impl: (x) => Number(x) * 2, returns: "number", arity: [1, 1], signature: "x" },
  ],
};

describe("pack-contributed formula functions", () => {
  beforeEach(() => {
    BUILTIN_PACKS.push(FIXTURE);
    initPackFormulas();
  });
  afterEach(() => {
    BUILTIN_PACKS.splice(BUILTIN_PACKS.indexOf(FIXTURE), 1);
    packsStore.setActive(FIXTURE.id, false);
    initPackFormulas();
  });

  it("registers the function so it is claimed by its pack", () => {
    expect(packFormulaNames()).toContain("TESTPACKDOUBLE");
  });

  it("COMPUTES while the pack is OFF — a saved graph must not break", () => {
    packsStore.setActive(FIXTURE.id, false);
    expect(resolveExcelFunction("TESTPACKDOUBLE")).not.toBeNull();
    expect(compileEvaluator("TESTPACKDOUBLE(21)")!({})).toBe(42);
  });

  it("is NOT advertised while the pack is off, and IS once it is on", () => {
    packsStore.setActive(FIXTURE.id, false);
    expect(advertisedFunctionNames()).not.toContain("TESTPACKDOUBLE");

    packsStore.setActive(FIXTURE.id, true);
    expect(advertisedFunctionNames()).toContain("TESTPACKDOUBLE");

    packsStore.setActive(FIXTURE.id, false);
    expect(advertisedFunctionNames()).not.toContain("TESTPACKDOUBLE");
  });

  it("never hides a CORE function when a pack toggles", () => {
    packsStore.setActive(FIXTURE.id, false);
    for (const core of ["SUM", "XLOOKUP", "TEXTSPLIT", "PRICE"]) {
      expect(advertisedFunctionNames(), core).toContain(core);
    }
  });

  it("surfaces the pack's argument hint through the editor's signature lookup", () => {
    expect(packFormulaSignature("TESTPACKDOUBLE")).toBe("x");
    expect(signatureFor("testpackdouble")).toBe("x");
  });
});

describe("name collisions fail loudly at startup", () => {
  const added: Pack[] = [];
  const add = (p: Pack) => { added.push(p); BUILTIN_PACKS.push(p); };
  afterEach(() => {
    for (const p of added) BUILTIN_PACKS.splice(BUILTIN_PACKS.indexOf(p), 1);
    added.length = 0;
    initPackFormulas();
  });

  it("rejects a pack claiming a name the core already dispatches", () => {
    // Silently shadowing SUM is exactly the drift formulaNaming exists to stop.
    add({ ...FIXTURE, id: "test-collide-core",
      formulas: [{ name: "SUM", impl: () => 0, returns: "number", arity: [1, 1] }] });
    expect(() => initPackFormulas()).toThrow(/already exists in the core/);
  });

  it("rejects a pack reviving a BLOCKED legacy spelling", () => {
    add({ ...FIXTURE, id: "test-collide-legacy",
      formulas: [{ name: "NORMDIST", impl: () => 0, returns: "number", arity: [1, 1] }] });
    expect(() => initPackFormulas()).toThrow(/already exists in the core/);
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

  it("a pack that is no longer present stops answering", () => {
    BUILTIN_PACKS.push(FIXTURE);
    initPackFormulas();
    expect(resolveExcelFunction("TESTPACKDOUBLE")).not.toBeNull();
    BUILTIN_PACKS.splice(BUILTIN_PACKS.indexOf(FIXTURE), 1);
    initPackFormulas();
    expect(resolveExcelFunction("TESTPACKDOUBLE")).toBeNull();
  });
});
