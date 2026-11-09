// [[B16]] oneFormulaSurface
// Tags are the words people mean a card by: each one, typed into the Add menu, lists its card first.
import { describe, it, expect } from "vitest";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { flattenLeaves, searchLeaves, isCategory, isPair } from "../../src/graph/catalogSearch";
import { CARD_TAGS } from "../../src/graph/catalogTags";
import { initPackFormulas } from "../../src/graph/formulaExtensions";
import { FUNCTION_ARITY, LEGACY_ALIASES } from "../../src/graph/excelFunctions";
import { NODE_EXCEL } from "../../src/graph/nodeExcel";
import { packFormulaNames } from "../../src/graph/formulaExtensions";
import type { CatalogEntry, NodeCatalogEntry } from "../../src/graph/AddNodeMenu";

initPackFormulas();
const catalog = buildCatalog(false);
const leaves = flattenLeaves(catalog);
const labels = new Map<string, string>();
const walk = (es: CatalogEntry[]): void => {
  for (const e of es) {
    if (isCategory(e) || isPair(e)) walk(e.children);
    else labels.set(e.type, e.label);
  }
};
walk(catalog);
const cardOf = (leaf: NodeCatalogEntry) => (leaf.places ?? leaf.type).split("__")[0];
const all = Object.entries(CARD_TAGS).flatMap(([type, tags]) => tags.map((tag) => [tag, type] as const));

describe("card tags", () => {
  it("name cards that exist", () => {
    expect(Object.keys(CARD_TAGS).filter((t) => !labels.has(t))).toEqual([]);
  });

  it("belong to one card each, and never repeat a card's label", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    const labelSet = new Map([...labels].map(([t, l]) => [l.toLowerCase(), t]));
    for (const [tag, type] of all) {
      if (tag !== tag.toLowerCase()) clashes.push(`${tag}: write tags in lower case`);
      if (seen.has(tag)) clashes.push(`${tag}: ${seen.get(tag)} and ${type}`);
      seen.set(tag, type);
      if (labelSet.has(tag)) clashes.push(`${tag}: the label of ${labelSet.get(tag)}`);
    }
    expect(clashes).toEqual([]);
  });

  // A formula or Excel name already ranks as a name, on a row that shows it ("SORT → List Sort"); a tag would bury that row.
  it("are never a formula or Excel name", () => {
    const names = new Set([
      ...Object.keys(FUNCTION_ARITY), ...Object.keys(LEGACY_ALIASES), ...packFormulaNames(),
      ...Object.values(NODE_EXCEL).flat().map((e) => e.excel),
    ].map((n) => n.toUpperCase()));
    expect(all.filter(([tag]) => names.has(tag.replace(/\s+/g, "").toUpperCase())).map(([tag, type]) => `${tag} (${type})`)).toEqual([]);
  });

  it.each(all)("%s lists %s first", (tag, type) => {
    const first = searchLeaves(leaves, tag)[0];
    expect(first && cardOf(first), `first: ${first?.label}`).toBe(type);
  });

  it("outrank a hidden op that shares the word (the backlog's first case)", () => {
    expect(cardOf(searchLeaves(leaves, "mean")[0])).toBe("reduce-avg");
  });
});
