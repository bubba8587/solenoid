// Function Reference — GENERATED from node metadata, not a hand-maintained list.
//
// The reference rows are derived by walking the catalog (core + packs): each node
// carries its own Excel equivalence (`NodeCatalogEntry.excel`), its Add-menu
// location is its position in the tree, its pack membership is `leaf.packs`, and
// "dependency" is whether one of its packs is depended-on by another pack. So a
// node (or a whole pack) appearing / disappearing moves its reference rows
// automatically — there is no parallel file to go stale.
//
// The only standalone data is the "Excel-only gap" (`EXCEL_GAP` in nodeExcel.ts) —
// functions Solenoid has no node for, which by definition can't be derived from a
// node. It self-corrects: any gap entry whose Excel name has become node-backed is
// dropped, so implementing a node always removes it from the missing list. And the
// dev catalog validator fails loudly if a mapped node lacks its Excel metadata, so
// the reverse (a shipped node missing from the reference) is caught.

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
  catalogType: string | null;
  location: string[];          // Add-menu path; [] for Excel-only gap rows
  packs: string[];
  dependency: boolean;         // a pack of this node is depended-on by another pack
  implemented: boolean;
  composition: boolean;        // no single node, but achievable by composing nodes
  parity: boolean;
  oos: boolean;
  note?: string;
  groupKey: string;            // section key
  groupLabel: string;          // section header text
}

interface LeafInfo {
  label: string;
  description?: string;
  path: string[];
  packs: string[];
  parity: boolean;
  excel?: ExcelEquiv[];
}

function isCategory(e: CatalogEntry): e is CatalogCategory { return e.type === "category"; }
function isPair(e: CatalogEntry): e is CatalogPair { return e.type === "pair"; }

// Walk the built catalog into a type → location/packs/parity/excel index.
function indexCatalog(): Map<string, LeafInfo> {
  const idx = new Map<string, LeafInfo>();
  const add = (leaf: NodeCatalogEntry, path: string[]) => {
    if (leaf.hidden) return; // deprecated — load-only, not referenced
    idx.set(leaf.type, {
      label: leaf.label,
      description: leaf.description,
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
    excel, syntax, nodeLabel: info.label, description: info.description, catalogType: type,
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

  // 1b. Solenoid-native nodes (no Excel equivalent) — so the reference is a
  //     complete node list, not just Excel parity. Grouped by Add-menu location
  //     (Control, Input, Output, …), which is how the user finds them.
  for (const [type, info] of idx) {
    if (info.excel?.length) continue; // already emitted as Excel rows above
    rows.push({
      excel: null, syntax: "", nodeLabel: info.label, description: info.description, catalogType: type,
      location: info.path, packs: info.packs, dependency: isDep(info.packs),
      implemented: true, composition: false, parity: true, oos: false,
      groupKey: `cat:${topGroup(info.path)}`, groupLabel: topGroup(info.path),
    });
  }

  // 2. Excel-only gap — functions with no node. Self-heals: an entry whose name
  //    has become node-backed (emitted above) is dropped.
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
