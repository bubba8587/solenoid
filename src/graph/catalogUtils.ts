import { NODE_CATALOG } from "./nodeCatalog";
import { packPlacements, packsStore, NODE_PACK_TAGS } from "./packs";
import { NODE_OPS, hiddenOps, exposureOf, opEntry } from "./nodeOps";
import { CATALOG_TO_EXCEL } from "./excelToCatalog";
import { NODE_EXCEL } from "./nodeExcel";
import { getEditor, getArea, processGraph, unselectAllNodes, selectNode } from "./process";
import type { NodeCatalogEntry, CatalogCategory, CatalogPair, CatalogEntry } from "./AddNodeMenu";
import { nodeNameStore } from "./nodeNameStore";
// Cycle-safe: nodeCtorRegistry imports FLAT_CATALOG from here, but neither module
// touches the other's exports at init time.
import { ctorRegistry, type NodeCtor } from "./nodeCtorRegistry";

// Pack nodes are INSERTED into the core tree at their target category path, so packs
// never grow the top level; a type claimed by several packs records every owner.

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

// Deep-clone (leaves included) so the builder can splice children and write `packs`
// without mutating the shared NODE_CATALOG.
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

function pruneEmpty(entries: CatalogEntry[]): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (isCategory(e)) {
      pruneEmpty(e.children);
      if (e.children.length === 0) entries.splice(i, 1);
    }
  }
}

// Only the Add-menu build filters by visibility — FLAT_CATALOG keeps hidden entries
// so saved graphs still resolve.
function leafVisible(leaf: NodeCatalogEntry, isActive: (id: string) => boolean): boolean {
  if (leaf.hidden) return false;
  return !leaf.packs?.length || leaf.packs.some(isActive);
}

// A pair whose halves don't both survive is demoted to a single leaf — a one-child
// pair would break the grid.
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

/** Build the Add-menu tree; `activeOnly` filters to active packs — pass false for the
 *  resolution map, which needs every node type present. */
export function buildCatalog(activeOnly: boolean): CatalogEntry[] {
  const root = NODE_CATALOG.map(cloneEntry);
  const byType = new Map<string, NodeCatalogEntry>();
  indexLeaves(root, byType);

  for (const [type, packIds] of Object.entries(NODE_PACK_TAGS)) {
    const leaf = byType.get(type);
    if (leaf) leaf.packs = [...(leaf.packs ?? []), ...packIds];
  }

  // A pack node may already carry `excel` inline on its entry; merge, don't clobber.
  for (const [type, equivs] of Object.entries(NODE_EXCEL)) {
    const leaf = byType.get(type);
    if (leaf) leaf.excel = [...(leaf.excel ?? []), ...equivs];
  }

  for (const { packId, placement } of packPlacements({ activeOnly })) {
    const existing = byType.get(placement.entry.type);
    if (existing) {
      if (existing.packs) {
        if (!existing.packs.includes(packId)) existing.packs.push(packId);
      } else {
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

  applyNodeOps(root, byType);

  if (activeOnly) return filterInactive(root, (id) => packsStore.isActive(id));
  pruneEmpty(root);
  return root;
}

/** Apply the multi-op declarations (`nodeOps.ts`): COLLAPSED records the leafless ops
 *  (the `{ }` marker + search rows); LEAVES generates them as siblings of the host. */
function applyNodeOps(root: CatalogEntry[], byType: Map<string, NodeCatalogEntry>): void {
  for (const decl of NODE_OPS) {
    const host = byType.get(decl.type);
    if (!host) continue;
    const hidden = hiddenOps(decl, host);
    if (!hidden.length || !decl.create) continue;
    if (exposureOf(decl) === "collapsed") {
      host.hiddenOps = hidden;
      // `mark: false` opts out of the glyph only — the ops stay searchable.
      if (decl.mark === false) host.hideOpsMark = true;
      continue;
    }
    const parent = findParent(root, host);
    if (!parent) continue;
    const at = parent.indexOf(host);
    parent.splice(at + 1, 0, ...hidden.map((op) => opEntry(decl, host, op)));
  }
}

/** The child list containing `leaf`; descends PAIRS as well as categories, or a host
 *  inside a pair silently generates zero leaves under expose: "leaves". */
function findParent(entries: CatalogEntry[], leaf: NodeCatalogEntry): CatalogEntry[] | null {
  if (entries.includes(leaf)) return entries;
  for (const e of entries) {
    if (e.type === "category" || e.type === "pair") {
      const hit = findParent((e as { children: CatalogEntry[] }).children, leaf);
      if (hit) return hit;
    }
  }
  return null;
}

// Built-in classification derived from the Excel mapping; pack nodes are classified
// by their pack, not here.
export type NodeClass = "core" | "matcher";
export function classifyType(type: string): NodeClass {
  return (CATALOG_TO_EXCEL.get(type)?.length ?? 0) > 0 ? "matcher" : "core";
}

// Over EVERY pack, active or not, so a deactivated pack's node type still resolves to
// its constructor when loading a saved graph.
export const FLAT_CATALOG: Map<string, NodeCatalogEntry> =
  flattenCatalog(buildCatalog(false));

// A placed node knows only its constructor (+ op), so index `${ctor.name}::${op}` by
// instantiating every leaf once; the ctor-only key covers unenumerated op values.
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

// Parallel to descIndex, for the catalog LABEL — a cleared title falls back to it, so
// the header never collapses to zero height.
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

export async function addNodeByCatalogType(catalogType: string): Promise<boolean> {
  const entry = FLAT_CATALOG.get(catalogType);
  if (!entry) return false;
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return false;

  // Cast through unknown: this file deliberately imports no node classes.
  const node = entry.create() as unknown as { id: string; width?: number; height?: number; constructor: { name: string }; hydrate?: (reg: Map<string, NodeCtor>) => Promise<void> };
  // A pre-seeded composite carries a pending internal snapshot — build its live
  // subgraph before the first recompute.
  if (node.hydrate) await node.hydrate(ctorRegistry());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await editor.addNode(node as any);
  nodeNameStore.ensure(node.id, node.constructor.name);

  const { k, x, y } = area.area.transform;
  const rect = area.container.getBoundingClientRect();
  const cx = (rect.width / 2 - x) / k;
  const cy = (rect.height / 2 - y) / k;
  await area.translate(node.id, {
    x: cx - (node.width ?? 180) / 2,
    y: cy - (node.height ?? 160) / 2,
  });

  await processGraph();

  unselectAllNodes();
  selectNode(node.id, false);
  return true;
}
