// [[C79]]
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { flattenLeaves, searchLeaves, filterByCompatibleSocket, quickWireCompatibleTypes } from "../../src/graph/catalogSearch";
import { buildCatalog } from "../../src/graph/catalogUtils";
import { SolenoidSocket, type SocketDataType } from "../../src/graph/sockets";
import type { NodeCatalogEntry } from "../../src/graph/AddNodeMenu";
import { packsStore, BUILTIN_PACKS } from "../../src/graph/packs";
import type { Pack } from "../../src/graph/packs/packShared";
import { NODE_OPS } from "../../src/graph/nodeOps";
import { NODE_EXCEL } from "../../src/graph/nodeExcel";
import { CATALOG_TO_EXCEL } from "../../src/graph/excelToCatalog";
import { LEGACY_ALIASES } from "../../src/graph/excelFunctions";

// Search against the REAL catalog tree (active entries only, as the menu does).
const leaves = flattenLeaves(buildCatalog(true));
const search = (q: string) => searchLeaves(leaves, q);
const types = (q: string, n = 5) => search(q).slice(0, n).map((l) => l.type);

describe("Add-menu search — category + type + keywords are searchable", () => {
  it("'arithmetic' surfaces the Arithmetic-category leaves (was: nothing)", () => {
    const r = search("arithmetic");
    // The Add/Subtract/Multiply/Divide leaves all live under the Arithmetic
    // category; at least the core four should appear.
    const arithTypes = r.map((l) => l.type).filter((t) => t.startsWith("arith-"));
    expect(arithTypes).toEqual(expect.arrayContaining(["arith-add", "arith-mul", "arith-div"]));
  });

  it("'table input' ranks the Table input node #1", () => {
    // Labeled "Table" under the "Input" category → label+category = "Table Input".
    expect(types("table input")[0]).toBe("table-input");
  });

  it("'text input' and 'frame input' find their input nodes", () => {
    expect(types("text input")).toContain("text-input");
    expect(types("frame input")).toContain("frame-input");
  });

  it("an exact label still wins (no regression from the wider haystack)", () => {
    expect(types("multiply")[0]).toBe("arith-mul");
  });

  it("an op-glyph label prefix doesn't demote the exact match ('add' → + Add first)", () => {
    // "+ Add" only earned the word-start tier while "Add Column"/"Add Index"
    // earned the prefix tier; the glyph-stripped label restores the exact tier.
    expect(types("add")[0]).toBe("arith-add");
    expect(types("subtract")[0]).toBe("arith-sub");
    expect(types("divide")[0]).toBe("arith-div");
  });

  it("Excel function names still match", () => {
    // SUMPRODUCT is an Excel name carried via the catalog→excel map.
    expect(search("sumproduct").length).toBeGreaterThan(0);
  });
});

// Per-word scoring: each query word lands independently (subsequence of the wide
// haystack, or one edit from a word the leaf answers to). A typo'd word must not
// bury its target under scattered-subsequence noise from long descriptions.
// (Author 2026-08-31: "frane input" surfaced nothing — Frame Input ranked 19th.)
describe("Add-menu search — typo tolerance and word order", () => {
  it("'frane input' (one-letter typo) ranks Frame Input #1", () => {
    expect(types("frane input")[0]).toBe("frame-input");
  });

  it("'input frame' (reversed word order) still surfaces Frame Input at the top", () => {
    expect(types("input frame")).toContain("frame-input");
  });

  it("a typo'd Excel name still finds its node ('xlokup' → XLOOKUP)", () => {
    expect(types("xlokup")).toContain("lookup-xlookup");
  });
});

// TAKE / DROP folded onto one rank-preserving card (D6). Both ops keep a bare
// Add-menu leaf (no "TAKE: Drop" colon row), and the family keywords carry the old
// "list take" / "table take" spellings so either surface still finds the card.
describe("TAKE / DROP — one card, two findable bare leaves", () => {
  it("'take' and 'drop' each surface their own bare leaf", () => {
    expect(search("take").some((l) => l.type === "takedrop")).toBe(true);
    expect(search("drop").some((l) => l.type === "takedrop-drop")).toBe(true);
    // No generated colon row — both ops are real leaves (leafOps).
    expect(leaves.some((l) => l.leaf.type.includes("takedrop__op-"))).toBe(false);
  });
  it("'list take' and 'table take' both still find TAKE via keywords", () => {
    expect(search("list take").some((l) => l.type === "takedrop")).toBe(true);
    expect(search("table take").some((l) => l.type === "takedrop")).toBe(true);
  });
});

describe("filterByCompatibleSocket — memoized socket signatures", () => {
  // A minimal fake leaf: quick-wire only reads `type` (the memo key) + `create()`.
  const mkLeaf = (type: string, inType: SocketDataType, onCreate: () => void) => ({
    leaf: {
      type,
      create: () => { onCreate(); return { inputs: { in: { socket: new SolenoidSocket(inType) } }, outputs: {} }; },
    } as unknown as NodeCatalogEntry,
    categoryPath: [] as string[],
  });

  it("instantiates each leaf ONCE across repeated drops (memo hit on the 2nd)", () => {
    let calls = 0;
    // Unique type ids so this test never collides with the session-lifetime cache.
    const leaves = [
      mkLeaf("memo-test-num-in", "number", () => { calls++; }),
      mkLeaf("memo-test-str-in", "string", () => { calls++; }),
    ];
    const origin = new SolenoidSocket("number"); // dragged from a number OUTPUT
    const r1 = filterByCompatibleSocket(leaves, origin, "output");
    const r2 = filterByCompatibleSocket(leaves, origin, "output");
    // number output → only the number INPUT accepts it (element separation blocks string).
    expect(r1.map((l) => l.leaf.type)).toEqual(["memo-test-num-in"]);
    expect(r2.map((l) => l.leaf.type)).toEqual(["memo-test-num-in"]); // identical result
    expect(calls).toBe(2); // 2 leaves × 1 create() each, NOT 4 — the 2nd pass hit the cache
  });

  it("genuinely narrows the real catalog for a dragged frame output", () => {
    const all = flattenLeaves(buildCatalog(true));
    const origin = new SolenoidSocket("frame");
    const compat = filterByCompatibleSocket(all, origin, "output");
    expect(compat.length).toBeGreaterThan(0);
    expect(compat.length).toBeLessThan(all.length); // it filters, not passes-through
  });

  it("quick-wire's dim set holds catalog leaf types: a number cable lights Arithmetic, not UPPER", () => {
    const set = quickWireCompatibleTypes(buildCatalog(true), new SolenoidSocket("number"), "output");
    const types = flattenLeaves(buildCatalog(true)).map((l) => l.leaf.type);
    expect(set.size).toBeLessThan(types.length);
    expect([...set].every((t) => types.includes(t))).toBe(true);
    expect(set.has("arith-add")).toBe(true);
    expect(set.has("text-upper")).toBe(false); // element families never auto-cross
  });
});

// The Node Packs settings section toggles packsStore, and buildCatalog(true) reads it —
// a deactivated pack's node leaves must leave the Add menu (its constructors stay
// registered so saved graphs still load; only the menu placement is gated).
describe("Add menu — a disabled pack's node leaves leave the tree (packsStore drives buildCatalog)", () => {
  const NODE_FIXTURE: Pack = {
    id: "test-node-pack",
    name: "Test Node Pack",
    description: "Fixture.",
    builtin: true,
    defaultActive: false,
    nodes: [{
      path: ["Docs & Files"],
      entry: { type: "__testPackLeaf", label: "Test Pack Leaf", create: () => ({}) } as NodeCatalogEntry,
    }],
  };
  beforeEach(() => { BUILTIN_PACKS.push(NODE_FIXTURE); });
  afterEach(() => {
    packsStore.setActive(NODE_FIXTURE.id, false);
    BUILTIN_PACKS.splice(BUILTIN_PACKS.indexOf(NODE_FIXTURE), 1);
  });

  const leafTypes = () => flattenLeaves(buildCatalog(true)).map((l) => l.leaf.type);

  it("shows the pack's leaf only while the pack is active", () => {
    packsStore.setActive(NODE_FIXTURE.id, false);
    expect(leafTypes()).not.toContain("__testPackLeaf");
    packsStore.setActive(NODE_FIXTURE.id, true);
    expect(leafTypes()).toContain("__testPackLeaf");
    packsStore.setActive(NODE_FIXTURE.id, false);
    expect(leafTypes()).not.toContain("__testPackLeaf");
  });
});

// An op-selector family is ONE card; its ops may be exposed as separate leaves (Range,
// LinSpace, … for Series). Typing the CARD's name must find every one of them, so each such
// leaf carries the family name in its label or keywords. (Author 2026-08-25: "series" found
// nothing — unacceptable; this pins it for every family.)
describe("op leaves are findable by their family's name", () => {
  it("every catalog leaf of an op-selector family carries the family name in its label or keywords", () => {
    const instances = leaves.map(({ leaf }) => { try { return leaf.create(); } catch { return null; } });
    const broken: string[] = [];
    for (const decl of NODE_OPS) {
      let family = "";
      try { family = String((new (decl.ctor as new () => { label?: string })()).label ?? "").trim(); } catch { continue; }
      if (!family) continue;
      const fam = family.toLowerCase();
      const own = leaves.filter((_, i) => instances[i] instanceof decl.ctor);
      // A family whose default name IS one of its op labels (a card called "ATAN2" with ops
      // LOG / DELTA / GESTEP) has no separate name to search for — only a real card name
      // (Series, Aggregate, Arithmetic…) must find its ops.
      if (own.some(({ leaf }) => leaf.label.toLowerCase() === fam)) continue;
      // A hidden-op row deliberately does NOT inherit its host's keywords (so sibling ops
      // still discriminate); its label starts with the host's, so it is found through the
      // host leaf — check the host's label + keywords for it.
      const hostOf = (type: string) => leaves.find((l) => l.leaf.type === type.split("__op-")[0])?.leaf;
      for (const { leaf } of own) {
        const host = leaf.type.includes("__op-") ? hostOf(leaf.type) ?? leaf : leaf;
        const hay = `${leaf.label} ${leaf.keywords ?? ""} ${host.label} ${host.keywords ?? ""}`.toLowerCase();
        if (!hay.includes(fam)) broken.push(`${leaf.type} "${leaf.label}" — family "${family}"`);
      }
    }
    expect(broken, "Op leaves that the family name would not find (add the family name to keywords):\n" + broken.join("\n")).toEqual([]);
  });
});

describe("Add-menu search — hyphenated tokens and word hits over description noise", () => {
  it("'savitzky-golay' finds Smooth, whose keyword is spelled with an en dash", () => {
    const all = flattenLeaves(buildCatalog(false));
    expect(searchLeaves(all, "savitzky-golay")[0]?.type).toBe("list-smooth");
    expect(searchLeaves(all, "savitzky golay")[0]?.type).toBe("list-smooth");
  });

  it("'sunm' ranks SUM ahead of leaves whose descriptions merely contain the letters", () => {
    const top = types("sunm", 3);
    expect(top[0]).toBe("reduce-sum");
  });
});

describe("Excel-alias rows never repeat a name a card already wears", () => {
  const all = flattenLeaves(buildCatalog(false));
  const bare = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
  const worn = new Set(all.filter((l) => !l.leaf.type.includes("__")).flatMap(({ leaf }) => [leaf.label, ...(leaf.hiddenOps ?? []).map((o) => o.label)]).map(bare));

  it("no alias row names another card or op", () => {
    const clashes = all.filter((l) => l.leaf.type.includes("__excel-")).map((l) => l.leaf.label).filter((label) => worn.has(bare(label.split(": ").pop()!)));
    expect(clashes).toEqual([]);
  });

  it("GROUPBY and SCAN find their own cards, not Group Lists or Running", () => {
    expect(types("GROUPBY", 1)).toEqual(["group-by-frame"]);
    expect(types("SCAN", 1)).toEqual(["scan-lambda"]);
    expect(search("GROUPBY").map((l) => l.label)).not.toContain("Group Lists: GROUPBY");
  });

  it("no card lists the same Excel name twice", () => {
    const dupes = Object.entries(NODE_EXCEL).filter(([, eqs]) => new Set(eqs.map((e) => e.excel)).size !== eqs.length).map(([t]) => t);
    expect(dupes).toEqual([]);
  });
});

// Common queries, Excel names and card names, each with the card it must land on first.
describe("Add-menu search — the top hit for common queries", () => {
  const TOP: [string, string][] = [
    ["sum", "reduce-sum"], ["average", "reduce-avg"], ["if", "if"], ["xlookup", "lookup-xlookup"],
    ["vlookup", "lookup-xlookup"], ["hlookup", "lookup-xlookup"], ["match", "lookup-xmatch"],
    ["index", "list-index"], ["unique", "list-unique"], ["countif", "sumifs__excel-COUNTIF"], ["sumif", "sumifs"],
    ["concat", "text-concat"], ["today", "date-today"], ["round", "roundn-round"], ["len", "text-len"],
    ["trim", "text-trim"], ["npv", "npv"], ["irr", "irr"], ["lambda", "lambda-make"],
    ["transpose", "table-transpose"], ["number input", "number-input"], ["list input", "list-input"],
    ["note", "note"], ["join", "join"], ["convert", "convert"], ["median", "reduce-median"],
    ["stdev", "reduce-stdev"], ["std dev", "reduce-stdev"], ["standard deviation", "reduce-stdev"],
    ["regex", "regex"], ["switch", "switch"], ["choose", "choose"], ["sequence", "list-sequence"],
    ["random", "randbetween"], ["group by", "group-by-frame"], ["histogram", "histogram"],
    ["slope", "regression-steyx__op-slope"], ["intercept", "regression-steyx__op-intercept"],
    ["rsq", "correl-correl__op-rsq"], ["steyx", "regression-steyx"],
    ["floor.precise", "math-floor"], ["ceiling.precise", "math-ceiling"], ["iso.ceiling", "math-ceiling"],
    ["dsum", "reduce-sum"], ["daverage", "reduce-avg"], ["dget", "lookup-xlookup"],
  ];
  it.each(TOP)("%s → %s", (q, type) => {
    expect(types(q, 1)).toEqual([type]);
  });

  it("every card and row label finds a row with that label first", () => {
    const misses = leaves.filter(({ leaf }) => search(leaf.label)[0]?.label !== leaf.label)
      .map(({ leaf }) => `${leaf.label} → ${search(leaf.label)[0]?.label}`);
    // RAND's own type is "randbetween", so the host outranks its RANDBETWEEN alias row; both place the same card.
    expect(misses).toEqual(["RANDBETWEEN → RAND"]);
  });

  it("a retired Excel name lands on the card that answers to its replacement", () => {
    const answering = (name: string) => leaves.filter(({ leaf }) => (CATALOG_TO_EXCEL.get(leaf.type) ?? []).includes(name)).map(({ leaf }) => leaf.type);
    const misses: string[] = [];
    for (const [legacy, target] of Object.entries(LEGACY_ALIASES)) {
      const hosts = answering(target);
      // A name a row already wears ("Sparkline: Column") keeps its own row first.
      if (!hosts.length || leaves.some(({ leaf }) => leaf.label.split(": ").pop()!.toUpperCase() === legacy)) continue;
      const top = search(legacy)[0]?.type.split("__")[0];
      if (!top || !hosts.includes(top)) misses.push(`${legacy} → ${top} (want ${hosts.join(", ")})`);
    }
    expect(misses).toEqual([]);
  });

  it("SLOPE, INTERCEPT and RSQ belong to the cards whose ops compute them", () => {
    expect(CATALOG_TO_EXCEL.get("regression-steyx")).toEqual(expect.arrayContaining(["SLOPE", "INTERCEPT"]));
    expect(CATALOG_TO_EXCEL.get("correl-correl")).toContain("RSQ");
    expect(CATALOG_TO_EXCEL.get("linest")).not.toEqual(expect.arrayContaining(["SLOPE"]));
  });
});
