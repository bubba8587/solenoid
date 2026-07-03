// Add-menu search scoring — extracted from AddNodeMenu so it's unit-testable and
// shared. The searchable text for a leaf is deliberately WIDER than what's shown:
// the label + description + Excel function names, PLUS the ancestor category path
// (so "arithmetic" finds the Add/Subtract/… leaves under the Arithmetic category,
// and "table input" finds the leaf labelled "Table" under the Input category),
// the kebab `type` id turned into words ("table-input" → "table input"), and an
// optional explicit `keywords` string for synonyms the label doesn't carry.

import { CATALOG_TO_EXCEL } from "./excelToCatalog";
import { fuzzyScore, fieldScore } from "./fuzzy";
import { SolenoidSocket } from "./sockets";
import type { NodeCatalogEntry, CatalogEntry, CatalogCategory, CatalogPair } from "./AddNodeMenu";

function isCategory(e: CatalogEntry): e is CatalogCategory {
  return (e as CatalogCategory).type === "category";
}
function isPair(e: CatalogEntry): e is CatalogPair {
  return (e as CatalogPair).type === "pair";
}

/** A leaf plus the labels of the categories it lives under (outermost first). */
export type LeafWithContext = { leaf: NodeCatalogEntry; categoryPath: string[] };

/** Flatten the catalog tree to leaves, carrying each leaf's ancestor category
 *  labels so search can match a node by the category it lives in. */
export function flattenLeaves(entries: CatalogEntry[], ancestors: string[] = []): LeafWithContext[] {
  const out: LeafWithContext[] = [];
  for (const e of entries) {
    if (isCategory(e)) out.push(...flattenLeaves(e.children, [...ancestors, e.label]));
    else if (isPair(e)) out.push(...e.children.map((leaf) => ({ leaf, categoryPath: ancestors })));
    else out.push({ leaf: e, categoryPath: ancestors });
  }
  return out;
}

// "table-input" → "table input"; "arith-add" → "arith add".
function typeWords(type: string): string {
  return type.replace(/[-_]/g, " ");
}

/** Score one leaf against a query, or null if the query isn't even a subsequence
 *  of its (wide) searchable text. Higher = better. */
export function scoreLeaf(query: string, { leaf, categoryPath }: LeafWithContext): number | null {
  const excelNames = CATALOG_TO_EXCEL.get(leaf.type) ?? [];
  const category = categoryPath.join(" ");
  const keywords = leaf.keywords ?? "";
  // Subsequence gate over everything searchable.
  const haystack = `${leaf.label} ${leaf.description ?? ""} ${excelNames.join(" ")} ${category} ${typeWords(leaf.type)} ${keywords}`;
  const s = fuzzyScore(query, haystack);
  if (s === null) return null;
  // Tiered bonus = the strongest tier among: the label, the label+category combo
  // (so "table input" EXACT-matches "Table Input" for a leaf labelled "Table"
  // under the Input category), the kebab type, keywords, and Excel names (Excel
  // weighed slightly under the rest so an exact label still wins a tie).
  const fields = [leaf.label, `${leaf.label} ${category}`, typeWords(leaf.type), keywords];
  let bonus = 0;
  for (const f of fields) {
    const fs = f.trim() ? fieldScore(query, f) : null;
    if (fs !== null) bonus = Math.max(bonus, fs);
  }
  for (const name of excelNames) {
    const fs = fieldScore(query, name);
    if (fs !== null) bonus = Math.max(bonus, fs - 10);
  }
  return s + bonus;
}

/** Rank leaves for a query (best first), dropping non-matches. */
export function searchLeaves(leaves: LeafWithContext[], query: string): NodeCatalogEntry[] {
  const scored: { leaf: NodeCatalogEntry; score: number }[] = [];
  for (const lc of leaves) {
    const score = scoreLeaf(query, lc);
    if (score !== null) scored.push({ leaf: lc.leaf, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.leaf);
}

// ─── Quick-wire compatibility filter ───────────────────────────────────────────
// Quick-wire drops a cable on empty canvas and needs the Add menu narrowed to
// nodes that can actually receive the dragged value. There's no static
// socket-type metadata on a catalog leaf, so this instantiates the leaf's node
// (the same `create()` a real pick calls) and inspects its live sockets — thrown
// away immediately, never added to the editor.

type PortLike = { socket?: unknown };
type NodeLike = {
  inputs?: Record<string, PortLike | undefined>;
  outputs?: Record<string, PortLike | undefined>;
};

/** `originSide` is which side the cable's ORIGIN socket is on: "output" means the
 *  user dragged from an output, so a candidate needs a compatible INPUT (and vice
 *  versa). Returns true if `leaf.create()` has at least one matching socket. */
function hasCompatibleSocket(
  leaf: NodeCatalogEntry,
  origin: SolenoidSocket,
  originSide: "input" | "output",
): boolean {
  const node = leaf.create() as NodeLike;
  const candidates = originSide === "output" ? node.inputs : node.outputs;
  if (!candidates) return false;
  for (const port of Object.values(candidates)) {
    const socket = port?.socket;
    if (!(socket instanceof SolenoidSocket)) continue;
    const ok = originSide === "output" ? origin.canConnectTo(socket) : socket.canConnectTo(origin);
    if (ok) return true;
  }
  return false;
}

/** Narrow leaves to those quick-wire can actually splice onto the dragged cable. */
export function filterByCompatibleSocket(
  leaves: LeafWithContext[],
  origin: SolenoidSocket,
  originSide: "input" | "output",
): LeafWithContext[] {
  return leaves.filter((lc) => hasCompatibleSocket(lc.leaf, origin, originSide));
}

/** First socket key on `node`, on the given side, that's compatible with
 *  `origin` — used to wire the freshly-created node once quick-wire's pick lands. */
export function firstCompatibleSocketKey(
  node: NodeLike,
  origin: SolenoidSocket,
  originSide: "input" | "output",
): string | null {
  const candidates = originSide === "output" ? node.inputs : node.outputs;
  if (!candidates) return null;
  for (const [key, port] of Object.entries(candidates)) {
    const socket = port?.socket;
    if (!(socket instanceof SolenoidSocket)) continue;
    const ok = originSide === "output" ? origin.canConnectTo(socket) : socket.canConnectTo(origin);
    if (ok) return key;
  }
  return null;
}
