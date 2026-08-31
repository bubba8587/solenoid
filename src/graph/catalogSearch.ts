// Add-menu search scoring. A leaf's searchable text is deliberately WIDER than what
// is shown — label, description, Excel names, category path, kebab type, keywords.

import { CATALOG_TO_EXCEL } from "./excelToCatalog";
import { fuzzyScore, fieldScore, tokenWordScore } from "./fuzzy";
import { opsFor, opEntry, excelEntry } from "./nodeOps";
import { SolenoidSocket, canConnect, type SocketDataType } from "./sockets";
import type { NodeCatalogEntry, CatalogEntry, CatalogCategory, CatalogPair } from "./AddNodeMenu";

function isCategory(e: CatalogEntry): e is CatalogCategory {
  return (e as CatalogCategory).type === "category";
}
function isPair(e: CatalogEntry): e is CatalogPair {
  return (e as CatalogPair).type === "pair";
}

/** A leaf plus the labels of the categories it lives under (outermost first). */
export type LeafWithContext = { leaf: NodeCatalogEntry; categoryPath: string[] };

/** Flatten the catalog to leaves, PLUS a row per hidden op — folding a family onto
 *  one leaf must never make an op unfindable. The rows are generated at SEARCH time,
 *  never inserted into the tree, so catalog walkers don't count them as extra nodes. */
export function flattenLeaves(entries: CatalogEntry[], ancestors: string[] = []): LeafWithContext[] {
  const out = flattenTree(entries, ancestors);
  for (const { leaf, categoryPath } of [...out]) {
    const decl = leaf.hiddenOps?.length ? opsFor(leaf.type) : undefined;
    // hiddenOps is only ever populated for a declaration that lists ops, so `create`
    // is present — the guard keeps that guarantee visible to the type checker.
    if (decl?.create) for (const op of leaf.hiddenOps!) out.push({ leaf: opEntry(decl, leaf, op), categoryPath });
    // An Excel name the leaf answers to that is not its own name or one of its ops (NAME-1).
    // A hidden op has a row of its own; the host's PRIMARY op does not, so an Excel
    // name that is the primary op (Type Check's ISNUMBER) still gets its alias row.
    const own = new Set([leaf.label, ...(leaf.hiddenOps ?? []).map((o) => o.label)].map(bareName));
    for (const name of CATALOG_TO_EXCEL.get(leaf.type) ?? []) {
      if (!own.has(name.toUpperCase())) out.push({ leaf: excelEntry(leaf, name), categoryPath });
    }
  }
  return out;
}

function flattenTree(entries: CatalogEntry[], ancestors: string[] = []): LeafWithContext[] {
  const out: LeafWithContext[] = [];
  for (const e of entries) {
    if (isCategory(e)) out.push(...flattenTree(e.children, [...ancestors, e.label]));
    else if (isPair(e)) out.push(...e.children.map((leaf) => ({ leaf, categoryPath: ancestors })));
    else out.push({ leaf: e, categoryPath: ancestors });
  }
  return out;
}

/** A label's name without a trailing parenthetical hint, upper-cased: "T.TEST (paired)"
 *  and "DATE (Build)" answer to T.TEST and DATE without a redundant alias row. */
function bareName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
}

function typeWords(type: string): string {
  return type.replace(/[-_]/g, " ");
}

// An op-glyph prefix ("+ Add") otherwise demotes an exact query to the word-start
// tier, letting "Add Column" outrank the Add node itself.
function stripGlyphPrefix(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+\s*/u, "");
}

/** Score one leaf against a query, or null when some query word lands nowhere on
 *  the leaf. Higher = better. */
export function scoreLeaf(query: string, { leaf, categoryPath }: LeafWithContext): number | null {
  const excelNames = CATALOG_TO_EXCEL.get(leaf.type) ?? [];
  const category = categoryPath.join(" ");
  const keywords = leaf.keywords ?? "";
  const haystack = `${leaf.label} ${leaf.description ?? ""} ${excelNames.join(" ")} ${category} ${typeWords(leaf.type)} ${keywords}`;
  const bare = stripGlyphPrefix(leaf.label);
  // Per-WORD gate and base score: every query word must land — as a subsequence of
  // the wide haystack (order-free across words, so "input frame" finds Frame Input)
  // or within one edit of a word the leaf answers to ("frane" finds Frame). Word
  // hits score far above the scattered-subsequence noise a long description
  // generates, so a typo'd word no longer buries its target under leaves whose
  // descriptions happen to contain the letters.
  const words = `${leaf.label} ${bare} ${typeWords(leaf.type)} ${keywords} ${category} ${excelNames.join(" ")}`
    .toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter(Boolean);
  let s = 0;
  for (const token of query.toLowerCase().split(/\s+/)) {
    if (!token) continue;
    const sub = fuzzyScore(token, haystack);
    const word = tokenWordScore(token, words);
    if (sub === null && word === 0) return null;
    s += (sub ?? 0) + word;
  }
  // Strongest whole-query tier across the fields; Excel names weigh slightly under
  // the rest so an exact label still wins a tie.
  const fields = [leaf.label, `${leaf.label} ${category}`, typeWords(leaf.type), keywords];
  if (bare && bare !== leaf.label) fields.push(bare);
  // A generated "Host: Name" row is FOUND by the name after the colon — an exact hit
  // on it ranks like an exact hit on a leaf's own label.
  const colon = leaf.label.indexOf(": ");
  if (colon > 0 && leaf.type.includes("__")) fields.push(leaf.label.slice(colon + 2));
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

// Quick-wire narrows the Add menu by socket type, which a leaf carries no metadata
// for: the types come off a throwaway `leaf.create()`, memoized because a node
// type's INITIAL sockets are deterministic per catalog `type`.

type PortLike = { socket?: unknown };
type NodeLike = {
  inputs?: Record<string, PortLike | undefined>;
  outputs?: Record<string, PortLike | undefined>;
};

/** The set of input / output socket dataTypes a node type exposes when freshly
 *  created — stable per catalog `type`, so it's cached for the app's lifetime. */
type SocketSignature = { inputs: SocketDataType[]; outputs: SocketDataType[] };
const _sigCache = new Map<string, SocketSignature>();

function socketTypesOf(ports: Record<string, PortLike | undefined> | undefined): SocketDataType[] {
  const out: SocketDataType[] = [];
  if (ports) {
    for (const port of Object.values(ports)) {
      const socket = port?.socket;
      if (socket instanceof SolenoidSocket) out.push(socket.dataType);
    }
  }
  return out;
}

function socketSignature(leaf: NodeCatalogEntry): SocketSignature {
  const cached = _sigCache.get(leaf.type);
  if (cached) return cached;
  const node = leaf.create() as NodeLike;
  const sig: SocketSignature = { inputs: socketTypesOf(node.inputs), outputs: socketTypesOf(node.outputs) };
  _sigCache.set(leaf.type, sig);
  return sig;
}

/** `originSide` is which side the cable's ORIGIN socket is on: "output" means the
 *  user dragged from an output, so a candidate needs a compatible INPUT (and vice
 *  versa). True if the leaf's memoized socket signature has one matching socket. */
function hasCompatibleSocket(
  leaf: NodeCatalogEntry,
  origin: SolenoidSocket,
  originSide: "input" | "output",
): boolean {
  const sig = socketSignature(leaf);
  const candidates = originSide === "output" ? sig.inputs : sig.outputs;
  for (const dt of candidates) {
    const ok = originSide === "output" ? canConnect(origin.dataType, dt) : canConnect(dt, origin.dataType);
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
