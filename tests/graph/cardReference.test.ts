// [[B16]] oneFormulaSurface
// The Reference's card pages: every formula that reaches a card shows on it, with its signature.
import { describe, it, expect } from "vitest";
import { buildCardReference, buildFunctionReference } from "../../src/graph/functionReference";
import { excelSection } from "../../src/graph/excelSections";
import { initPackFormulas } from "../../src/graph/formulaExtensions";

initPackFormulas();
const cards = buildCardReference();
const card = (type: string) => cards.find((c) => c.type === type)!;

describe("a card's page", () => {
  it("lists the formulas of its ops, with the op that answers each", () => {
    const smooth = card("list-smooth");
    expect(smooth.formulas.map((f) => f.name)).toEqual(expect.arrayContaining(["SAVGOL", "GAUSSIANSMOOTH", "MEDIANSMOOTH"]));
    expect(smooth.formulas.find((f) => f.name === "GAUSSIANSMOOTH")).toMatchObject({ via: "Gaussian", signature: expect.stringContaining("sigma") });
  });

  it("finds a formula whose name is nothing like the card's", () => {
    expect(card("table-mult").formulas.map((f) => f.name)).toContain("KRON");
    expect(card("interpolate").formulas.find((f) => f.name === "GRIDDATA")?.via).toBe("Points mode");
  });

  it("keeps Excel's names in their own rows, with Excel's syntax", () => {
    const sum = card("reduce-sum");
    expect(sum.excel[0]).toMatchObject({ name: "SUM", parity: true });
    expect(sum.formulas.map((f) => f.name)).not.toContain("SUM");
  });

  it("covers pack cards whether their pack is on or off", () => {
    expect(card("grid-connected-regions").packs).toEqual(["signals"]);
  });
});

describe("Excel Coverage", () => {
  it("files every Excel function under one of Excel's sections", () => {
    const unfiled = buildFunctionReference().filter((r) => r.excel !== null && !excelSection(r.excel)).map((r) => r.excel);
    expect(unfiled).toEqual([]);
  });
});
