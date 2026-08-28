// GENERATED from catalog metadata — never add a hand-maintained row here. The one
// piece of standalone data is EXCEL_GAP (functions with no node), which self-heals.

import { buildCatalog } from "./catalogUtils";
import { EXCEL_GAP } from "./nodeExcel";
import { allPacks } from "./packs";
import type {
  CatalogEntry, CatalogCategory, CatalogPair, NodeCatalogEntry, ExcelEquiv,
} from "./AddNodeMenu";

export interface FnRefRow {
  excel: string | null;        // null = a Solenoid-native node (no Excel function)
  syntax: string;
  nodeLabel: string | null;    // catalog label, or null when no node covers it
  description?: string;        // the node's prose "what it does" (catalog description)
  keywords?: string;           // the catalog's search keywords (library names ride here too)
  catalogType: string | null;
  location: string[];          // Add-menu path; [] for Excel-only gap rows
  packs: string[];
  dependency: boolean;         // a pack of this node is depended-on by another pack
  implemented: boolean;
  composition: boolean;        // no single node, but achievable by composing nodes
  parity: boolean;
  oos: boolean;
  note?: string;
  groupKey: string;
  groupLabel: string;
}

interface LeafInfo {
  label: string;
  description?: string;
  keywords?: string;
  path: string[];
  packs: string[];
  parity: boolean;
  excel?: ExcelEquiv[];
}

function isCategory(e: CatalogEntry): e is CatalogCategory { return e.type === "category"; }
function isPair(e: CatalogEntry): e is CatalogPair { return e.type === "pair"; }

function indexCatalog(): Map<string, LeafInfo> {
  const idx = new Map<string, LeafInfo>();
  const add = (leaf: NodeCatalogEntry, path: string[]) => {
    if (leaf.hidden) return; // deprecated — load-only, not referenced
    idx.set(leaf.type, {
      label: leaf.label,
      description: leaf.description,
      keywords: leaf.keywords,
      path,
      packs: leaf.packs ?? [],
      parity: leaf.parity ?? true,
      excel: leaf.excel,
    });
  };
  const walk = (entries: CatalogEntry[], path: string[]) => {
    for (const e of entries) {
      if (isCategory(e)) walk(e.children, [...path, e.label]);
      else if (isPair(e)) { add(e.children[0], path); add(e.children[1], path); }
      else add(e, path);
    }
  };
  walk(buildCatalog(false), []);
  return idx;
}

// Pack ids that some other pack depends on.
function dependedOnPacks(): Set<string> {
  const s = new Set<string>();
  for (const p of allPacks()) for (const d of p.dependsOn ?? []) s.add(d);
  return s;
}

/** Build the full Function Reference, generated from catalog/node metadata. */
export function buildFunctionReference(): FnRefRow[] {
  const idx = indexCatalog();
  const dependedOn = dependedOnPacks();
  const rows: FnRefRow[] = [];
  const emitted = new Set<string>();

  const isDep = (packs: string[]) => packs.some((p) => dependedOn.has(p));
  const topGroup = (path: string[]) => (path.length ? path[0] : "Other");

  const nodeRow = (
    excel: string | null, syntax: string, type: string, info: LeafInfo,
    parity: boolean, note?: string,
  ): FnRefRow => ({
    excel, syntax, nodeLabel: info.label, description: info.description, keywords: info.keywords, catalogType: type,
    location: info.path, packs: info.packs, dependency: isDep(info.packs),
    implemented: true, composition: false, parity, oos: false, note,
    groupKey: `cat:${topGroup(info.path)}`,
    groupLabel: topGroup(info.path),
  });

  // 1. Node-backed rows straight from catalog metadata (`leaf.excel`).
  for (const [type, info] of idx) {
    for (const eq of info.excel ?? []) {
      rows.push(nodeRow(eq.excel, eq.syntax, type, info, eq.parity ?? info.parity, eq.note));
      emitted.add(eq.excel);
    }
  }

  // 1b. Solenoid-native nodes — the reference is a complete node list, not just parity.
  for (const [type, info] of idx) {
    if (info.excel?.length) continue; // already emitted as Excel rows above
    rows.push({
      excel: null, syntax: "", nodeLabel: info.label, description: info.description, keywords: info.keywords, catalogType: type,
      location: info.path, packs: info.packs, dependency: isDep(info.packs),
      implemented: true, composition: false, parity: true, oos: false,
      groupKey: `cat:${topGroup(info.path)}`, groupLabel: topGroup(info.path),
    });
  }

  // 2. Excel-only gap — self-heals: an entry that became node-backed above is dropped.
  for (const g of EXCEL_GAP) {
    if (emitted.has(g.excel)) continue;
    const composition = g.composition ?? false;
    rows.push({
      excel: g.excel, syntax: g.syntax, nodeLabel: null, catalogType: null,
      location: [], packs: [], dependency: false, implemented: false,
      composition, parity: false, oos: g.oos ?? false, note: g.note,
      groupKey: composition ? "compose" : "gap",
      groupLabel: composition ? "Composable" : "No Solenoid node",
    });
  }

  return rows;
}

/** Section groups in display order: Add-menu top-level categories, then the gap. */
export function fnRefGroups(rows: FnRefRow[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.groupKey)) seen.set(r.groupKey, r.groupLabel);
  const keys = [...seen.keys()];
  // Catalog groups first (first-seen order), then composable, then the gap.
  const rank = (k: string) => (k === "gap" ? 2 : k === "compose" ? 1 : 0);
  keys.sort((a, b) => rank(a) - rank(b));
  return keys.map((k) => ({ key: k, label: seen.get(k)! }));
}

// ─── Library tags (the Reference overlay's numpy / pandas / scipy / R / SQL / Excel filter) ──
// Derived from the catalog prose + keywords, never hand-kept: a description that cites
// `numpy.gradient`, `pandas ewm`, `scipy kruskal`, `R cor(…)`, `dplyr ntile`, `SQL OVER` tags
// the row, so a refugee from that library can narrow the Reference to what they know.
export const LIBRARY_TAGS = ["numpy", "pandas", "scipy", "R", "SQL", "Excel"] as const;
export type LibraryTag = (typeof LIBRARY_TAGS)[number];

const LIB_PATTERNS: ReadonlyArray<[LibraryTag, RegExp]> = [
  ["numpy",  /\bnumpy\b|\bnp\.[a-z]/i],
  ["pandas", /\bpandas\b|\bpd\.[a-z]|\bdf\.[a-z]|\bgroupby\(/i],
  ["scipy",  /\bscipy\b|\bstatsmodels\b|\brapidfuzz\b|\bnumpy_financial\b/i],
  // "R cor", "R's", "R findInterval", dplyr / tidyr / lubridate / stringr / forecast::
  ["R",      /(?:^|[\s(—;,])R(?:'s)? (?=[a-z])|\b(?:dplyr|tidyr|lubridate|stringr|stringdist|geosphere|fitdistrplus|forecast::|deSolve)\b/],
  ["SQL",    /\bSQL\b/],
];

/** The libraries a row cites; `Excel` when it has an Excel function or the prose names one. */
export function libraryTags(row: Pick<FnRefRow, "excel" | "description" | "keywords" | "note">): LibraryTag[] {
  // Descriptions are inline markdown (descriptionMd.ts); the code-span backticks
  // must not break citation adjacency ("R `boxplot.stats`").
  const text = `${row.description ?? ""} ${row.keywords ?? ""} ${row.note ?? ""}`.replace(/`/g, "");
  const tags: LibraryTag[] = [];
  for (const [tag, re] of LIB_PATTERNS) if (re.test(text)) tags.push(tag);
  if (row.excel !== null || /\bExcel\b/.test(text)) tags.push("Excel");
  return tags;
}
