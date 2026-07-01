import { NODE_CATALOG } from "./nodeCatalog";
import { packPlacements, packsStore, NODE_PACK_TAGS } from "./packs";
import { CATALOG_TO_EXCEL } from "./excelToCatalog";
import { NODE_EXCEL } from "./nodeExcel";
import { getEditor, getArea, processGraph, unselectAllNodes, selectNode } from "./process";
import type { NodeCatalogEntry, CatalogCategory, CatalogPair, CatalogEntry } from "./AddNodeMenu";

// ─── Catalog assembly ──────────────────────────────────────────────────────────
// The Add-menu catalog is the hand-authored core tree (NODE_CATALOG) with each
// active pack's nodes INSERTED into it at their target category path — so packs
// never grow the top level. A node `type` claimed by multiple packs is inserted
// once and records every owning pack (the leaf's `packs[]`, which drives the
// subtle "from a pack" indicator in AddNodeMenu).

function isCategory(e: CatalogEntry): e is CatalogCategory { return e.type === "category"; }
function isPair(e: CatalogEntry): e is CatalogPair { return e.type === "pair"; }

function flattenCatalog(
  entries: CatalogEntry[],
  out = new Map<string, NodeCatalogEntry>(),
): Map<string, NodeCatalogEntry> {
  for (const e of entries) {
    if (isCategory(e)) {
      flattenCatalog(e.children, out);
    } else if (isPair(e)) {
      for (const child of e.children) out.set(child.type, child);
    } else {
      out.set(e.type, e);
    }
  }
  return out;
}

// Deep-clone so we can splice category children and tag leaves with pack
// membership without mutating the shared NODE_CATALOG. Leaves are copied too,
// since the builder writes `packs` onto reclassified core leaves.
function cloneEntry(e: CatalogEntry): CatalogEntry {
  if (isCategory(e)) return { ...e, children: e.children.map(cloneEntry) };
  if (isPair(e)) return { ...e, children: [{ ...e.children[0] }, { ...e.children[1] }] };
  return { ...e };
}

function indexLeaves(entries: CatalogEntry[], out: Map<string, NodeCatalogEntry>): void {
  for (const e of entries) {
    if (isCategory(e)) indexLeaves(e.children, out);
    else if (isPair(e)) { out.set(e.children[0].type, e.children[0]); out.set(e.children[1].type, e.children[1]); }
    else out.set(e.type, e);
  }
}

// Find (or create) the category at `path` (a chain of category labels).
function ensureCategory(entries: CatalogEntry[], path: string[]): CatalogCategory {
  let level = entries;
  let cat: CatalogCategory | null = null;
  for (const label of path) {
    let found = level.find((e): e is CatalogCategory => isCategory(e) && e.label === label);
    if (!found) {
      found = { type: "category", label, children: [] };
      level.push(found);
    }
    cat = found;
    level = found.children;
  }
  return cat!;
}

// Drop categories left empty (e.g. "Other" when no active pack targeted it).
function pruneEmpty(entries: CatalogEntry[]): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (isCategory(e)) {
      pruneEmpty(e.children);
      if (e.children.length === 0) entries.splice(i, 1);
    }
  }
}

// A leaf is visible if it isn't deprecated (`hidden`) and it's built-in (no
// packs) or at least one owning pack is on. Only the Add-menu build filters by
// this — FLAT_CATALOG keeps hidden entries so saved graphs still resolve.
function leafVisible(leaf: NodeCatalogEntry, isActive: (id: string) => boolean): boolean {
  if (leaf.hidden) return false;
  return !leaf.packs?.length || leaf.packs.some(isActive);
}

// Remove leaves whose packs are all inactive. Pairs whose two halves don't both
// survive are demoted to a single leaf (a one-child pair would break the grid);
// empty categories are dropped.
function filterInactive(entries: CatalogEntry[], isActive: (id: string) => boolean): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const e of entries) {
    if (isCategory(e)) {
      const kids = filterInactive(e.children, isActive);
      if (kids.length) out.push({ ...e, children: kids });
    } else if (isPair(e)) {
      const kept = [e.children[0], e.children[1]].filter((c) => leafVisible(c, isActive));
      if (kept.length === 2) out.push(e);
      else if (kept.length === 1) out.push(kept[0]);
    } else if (leafVisible(e, isActive)) {
      out.push(e);
    }
  }
  return out;
}

/** Build the Add-menu tree: core + (active or all) pack nodes, with pack-tagged
 *  core nodes marked / hidden by activation. `activeOnly` filters to active packs;
 *  pass false for the resolution map (every node type present). */
export function buildCatalog(activeOnly: boolean): CatalogEntry[] {
  const root = NODE_CATALOG.map(cloneEntry);
  const byType = new Map<string, NodeCatalogEntry>();
  indexLeaves(root, byType);

  // Tag existing core nodes that have been reclassified into packs.
  for (const [type, packIds] of Object.entries(NODE_PACK_TAGS)) {
    const leaf = byType.get(type);
    if (leaf) leaf.packs = [...(leaf.packs ?? []), ...packIds];
  }

  // Attach each node's Excel equivalence (the Function Reference derives from this).
  // Pack nodes may already carry `excel` inline on their entry; merge, don't clobber.
  for (const [type, equivs] of Object.entries(NODE_EXCEL)) {
    const leaf = byType.get(type);
    if (leaf) leaf.excel = [...(leaf.excel ?? []), ...equivs];
  }

  // Insert pack-only nodes by placement, deduped by type.
  for (const { packId, placement } of packPlacements({ activeOnly })) {
    const existing = byType.get(placement.entry.type);
    if (existing) {
      if (existing.packs) {
        if (!existing.packs.includes(packId)) existing.packs.push(packId); // multi-pack node
      } else {
        // A pack tried to redefine a core node — keep core, flag the conflict.
        console.warn(`[packs] "${placement.entry.type}" from pack "${packId}" collides with a core node — ignoring the pack copy`);
      }
      continue;
    }
    const path = placement.path && placement.path.length ? placement.path : ["Other"];
    const cat = ensureCategory(root, path);
    const leaf: NodeCatalogEntry = { ...placement.entry, packs: [packId] };
    cat.children.push(leaf);
    byType.set(leaf.type, leaf);
  }

  if (activeOnly) return filterInactive(root, (id) => packsStore.isActive(id));
  pruneEmpty(root);
  return root;
}

// Built-in classification, derived (best-effort) from the Excel mapping: a node is
// a "matcher" if it maps to a real Excel function, otherwise a Solenoid-native
// "core" primitive. Pack nodes are classified by their pack, not here. The user
// can refine individual calls later.
export type NodeClass = "core" | "matcher";
export function classifyType(type: string): NodeClass {
  return (CATALOG_TO_EXCEL.get(type)?.length ?? 0) > 0 ? "matcher" : "core";
}

// Flat type→entry map over EVERY pack (active or not), so a node type from a
// deactivated pack still resolves to its constructor when loading a saved graph.
export const FLAT_CATALOG: Map<string, NodeCatalogEntry> =
  flattenCatalog(buildCatalog(false));

// ─── Node hover descriptions ──────────────────────────────────────────────────
// The catalog's one-line descriptions are keyed by type string, but a placed
// node only knows its constructor (+ op). Build — lazily, once — an index from
// `${ctor.name}::${op}` to description by instantiating each leaf (constructors
// are plain object builds; ~400 of them once on first hover is nothing). A
// ctor-only fallback covers op values the catalog doesn't enumerate.
let _descIndex: Map<string, string> | null = null;
function descIndex(): Map<string, string> {
  if (_descIndex) return _descIndex;
  _descIndex = new Map();
  for (const entry of FLAT_CATALOG.values()) {
    if (!entry.description) continue;
    try {
      const inst = entry.create() as unknown as { constructor: { name: string }; op?: unknown };
      const ctor = inst.constructor.name;
      const op = typeof inst.op === "string" ? inst.op : "";
      if (!_descIndex.has(`${ctor}::${op}`)) _descIndex.set(`${ctor}::${op}`, entry.description);
      if (!_descIndex.has(`${ctor}::`)) _descIndex.set(`${ctor}::`, entry.description);
    } catch {
      // A leaf that fails to build must not break hover for everything else.
    }
  }
  return _descIndex;
}

/** Catalog description for a placed node (op-aware), or null if unknown. */
export function describeNode(node: object): string | null {
  const idx = descIndex();
  const ctor = (node as { constructor: { name: string } }).constructor.name;
  const op = (node as { op?: unknown }).op;
  return (
    idx.get(`${ctor}::${typeof op === "string" ? op : ""}`) ??
    idx.get(`${ctor}::`) ??
    null
  );
}

// Parallel to descIndex but for the catalog LABEL — used as a node's header
// placeholder so a cleared title still reads as the node's name (and the header
// never collapses to zero height). Same `${ctor}::${op}` keying.
let _nameIndex: Map<string, string> | null = null;
function nameIndex(): Map<string, string> {
  if (_nameIndex) return _nameIndex;
  _nameIndex = new Map();
  for (const entry of FLAT_CATALOG.values()) {
    if (!entry.label) continue;
    try {
      const inst = entry.create() as unknown as { constructor: { name: string }; op?: unknown };
      const ctor = inst.constructor.name;
      const op = typeof inst.op === "string" ? inst.op : "";
      if (!_nameIndex.has(`${ctor}::${op}`)) _nameIndex.set(`${ctor}::${op}`, entry.label);
      if (!_nameIndex.has(`${ctor}::`)) _nameIndex.set(`${ctor}::`, entry.label);
    } catch { /* a leaf that fails to build must not break naming for the rest */ }
  }
  return _nameIndex;
}

/** Catalog label (node name) for a placed node (op-aware), or null if unknown. */
export function nodeName(node: object): string | null {
  const idx = nameIndex();
  const ctor = (node as { constructor: { name: string } }).constructor.name;
  const op = (node as { op?: unknown }).op;
  return (
    idx.get(`${ctor}::${typeof op === "string" ? op : ""}`) ??
    idx.get(`${ctor}::`) ??
    null
  );
}

// ─── Add a node to the canvas by catalog type ────────────────────────────────
// Returns true if the entry was found and added.

export async function addNodeByCatalogType(catalogType: string): Promise<boolean> {
  const entry = FLAT_CATALOG.get(catalogType);
  if (!entry) return false;
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return false;

  // create() returns one of our node classes — cast through unknown to satisfy
  // the editor's generic constraint without importing every node type here.
  const node = entry.create() as unknown as { id: string; width?: number; height?: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await editor.addNode(node as any);

  // Center on the current viewport.
  const { k, x, y } = area.area.transform;
  const rect = area.container.getBoundingClientRect();
  const cx = (rect.width / 2 - x) / k;
  const cy = (rect.height / 2 - y) / k;
  await area.translate(node.id, {
    x: cx - (node.width ?? 180) / 2,
    y: cy - (node.height ?? 160) / 2,
  });

  await processGraph();

  // Select the freshly-added node (e.g. added from the Function Reference) so
  // it's ready to move/configure on the canvas.
  unselectAllNodes();
  selectNode(node.id, false);
  return true;
}
