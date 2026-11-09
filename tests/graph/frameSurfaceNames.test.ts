// [[B16]], [[add-menu#Naming a placed node]], [[B16]] oneFormulaSurface, [[C15]] matricesInFormulas, [[formula-language#Blocked and wrong-surface names]], [[formula-language#Excel names on nodes]]
import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { despace } from "../../src/graph/formulaNodeParity";
import { FRAME_SURFACE_NAMES, NODE_SURFACE_NAMES, LEGACY_ALIASES } from "../../src/graph/excelFunctions";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { formulaFunctionNames } from "../../src/graph/excelFunctions";
import { initPackFormulas } from "../../src/graph/formulaExtensions";
import { highlightFormula } from "../../src/graph/formulaSyntax";
import { signatureFor } from "../../src/graph/formulaSignatures";
import { isSolError } from "../../src/graph/errorValue";
import type { CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry } from "../../src/graph/AddNodeMenu";

const typeable = (n: string) => /^[A-Z][A-Z0-9.]*$/.test(n);

const isCategory = (e: CatalogEntry): e is CatalogCategory => e.type === "category";
const isPair = (e: CatalogEntry): e is CatalogPair => e.type === "pair";

/** Every visible Frames or Tables leaf: its typeable candidate names + label. */
function frameLeaves(): Array<{ names: string[]; label: string }> {
  const out: Array<{ names: string[]; label: string }> = [];
  const walk = (entries: CatalogEntry[], path: string[]): void => {
    for (const e of entries) {
      if (isCategory(e)) { walk(e.children, [...path, e.label]); continue; }
      if (isPair(e)) { walk(e.children, path); continue; }
      const leaf: NodeCatalogEntry = e;
      if (leaf.hidden || (path[0] !== "Frames" && path[0] !== "Tables")) continue;
      const names = [...new Set([despace(leaf.label), ...(leaf.excel ?? []).map((x) => x.excel.toUpperCase())])];
      out.push({ names: names.filter(typeable), label: leaf.label });
    }
  };
  walk(buildCatalog(false), []);
  return out;
}

describe("FRAME_SURFACE_NAMES ← catalog derivation (both ways)", () => {
  initPackFormulas();
  const dispatchable = new Set(formulaFunctionNames().map((n) => n.toUpperCase()));
  const leaves = frameLeaves();

  it("every Frames or Tables leaf whose typeable name doesn't dispatch is in the map", () => {
    const missing: string[] = [];
    for (const leaf of leaves) {
      for (const n of leaf.names) {
        if (!dispatchable.has(n) && !(n in FRAME_SURFACE_NAMES)) missing.push(`${n} (${leaf.label})`);
      }
    }
    expect(missing, "frame-verb names a user could type that would fall to a typo's #NAME?").toEqual([]);
  });

  it("no map entry shadows a dispatchable name, a legacy alias, or a ghost leaf", () => {
    const labels = new Set<string>();
    const collect = (entries: CatalogEntry[]): void => {
      for (const e of entries) {
        if (isCategory(e)) { collect(e.children); continue; }
        if (isPair(e)) { collect(e.children); continue; }
        if (!e.hidden) labels.add(e.label);
      }
    };
    collect(buildCatalog(false));
    const shadowing = Object.keys(FRAME_SURFACE_NAMES).filter((n) => dispatchable.has(n));
    const legacy = Object.keys(FRAME_SURFACE_NAMES).filter((n) => n in LEGACY_ALIASES);
    const ghosts = Object.entries(FRAME_SURFACE_NAMES).filter(([, label]) => !labels.has(label));
    expect(shadowing, "a blocked name that ALSO dispatches would refuse a working function").toEqual([]);
    expect(legacy, "a name can't be both a legacy redirect and a frame verb").toEqual([]);
    expect(ghosts.map(([n, l]) => `${n} → "${l}"`), "redirects must point at real catalog leaves").toEqual([]);
  });

  const COUNT_FNS = new Set(["ROWS", "COLUMNS", "ROW", "COLUMN"]);
  it("no Frames or Tables leaf is named for a bare count/structural function", () => {
    const collisions = leaves
      .filter((l) => COUNT_FNS.has(despace(l.label)))
      .map((l) => l.label);
    expect(collisions, "a leaf named ROWS/COLUMNS reads as the count function, not this verb").toEqual([]);
  });
});

describe("a typed frame verb is recognized and refused, not a typo", () => {
  it("dispatch answers #TYPE! naming the node (Expression and Equation share this path)", () => {
    const r = compileEvaluator("JOIN(1, 2)")!({});
    expect(isSolError(r) && r.code).toBe("#TYPE!");
    expect(isSolError(r) && r.message).toContain("Join node");
    const p = compileEvaluator("PIVOTBY(x)")!({ x: [1, 2] });
    expect(isSolError(p) && p.message).toContain("PIVOTBY node");
  });

  it("the editor colors it in the frame violet, distinct from the typo red", () => {
    expect(highlightFormula("JOIN(a, b)")).toContain('class="fx-frame"');
    expect(highlightFormula("JOINN(a, b)")).toContain('class="fx-unknown"');
  });

  it("the hint bar carries the redirect", () => {
    expect(signatureFor("getcolumn")).toBe("frame verb — use the Get Column node");
  });
});

describe("a node-only verb (TEXTFILTER → List Filter) is recognized and redirected", () => {
  initPackFormulas();

  it("dispatch answers #NAME? naming the node", () => {
    const r = compileEvaluator('TEXTFILTER(x, "a")')!({ x: ["ab", "cd"] });
    expect(isSolError(r) && r.code).toBe("#NAME?");
    expect(isSolError(r) && r.message).toContain("List Filter node");
  });

  it("the editor colors it in the recognized-verb violet, not the typo red", () => {
    expect(highlightFormula('TEXTFILTER(x, "a")')).toContain('class="fx-frame"');
  });

  it("the hint bar carries the redirect", () => {
    expect(signatureFor("textfilter")).toBe("use the List Filter node");
  });

  it("every target is a real catalog leaf and never shadows a live/blocked name", () => {
    const dispatchable = new Set(formulaFunctionNames().map((n) => n.toUpperCase()));
    const labels = new Set<string>();
    const walk = (entries: CatalogEntry[]): void => {
      for (const e of entries) {
        if (isCategory(e)) { walk(e.children); continue; }
        if (isPair(e)) { walk(e.children); continue; }
        if (!e.hidden) labels.add(e.label);
      }
    };
    walk(buildCatalog(false));
    for (const [name, label] of Object.entries(NODE_SURFACE_NAMES)) {
      expect(labels.has(label), `${name} → "${label}" must point at a real catalog leaf`).toBe(true);
      expect(dispatchable.has(name), `${name} must not also dispatch`).toBe(false);
      expect(name in LEGACY_ALIASES, `${name} can't be both a legacy alias and a node verb`).toBe(false);
      expect(name in FRAME_SURFACE_NAMES, `${name} can't be both a frame verb and a node verb`).toBe(false);
    }
  });
});
