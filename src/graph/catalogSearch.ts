// [[D5]] searchWiderThanLabel, [[C19]] namingModel
import { CATALOG_TO_EXCEL } from "./excelToCatalog";
import { LEGACY_ALIASES } from "./excelFunctions";
import { fuzzyScoreLower, fieldScoreLower, tokenWordScore, withinOneEdit } from "./fuzzy";
import { opsFor, opEntry, excelEntry } from "./nodeOps";
import { nodeTypeName } from "./nodeNamer";
import { SolenoidSocket, canConnect, type SocketDataType } from "./sockets";
import type { NodeCatalogEntry, CatalogEntry, CatalogCategory, CatalogPair } from "./AddNodeMenu";

function isCategory(e: CatalogEntry): e is CatalogCategory {
  return (e as CatalogCategory).type === "category";
}
function isPair(e: CatalogEntry): e is CatalogPair {
  return (e as CatalogPair).type === "pair";
}

export type LeafWithContext = { leaf: NodeCatalogEntry; categoryPath: string[] };

export function flattenLeaves(entries: CatalogEntry[], ancestors: string[] = []): LeafWithContext[] {
  const out = flattenTree(entries, ancestors);
  // A name any card or op already wears gets no alias row, so the menu never shows "Group Lists: GROUPBY" beside GROUPBY.
  const worn = new Set(out.flatMap(({ leaf }) => [leaf.label, ...(leaf.hiddenOps ?? []).map((o) => o.label)]).map(bareName));
  for (const { leaf, categoryPath } of [...out]) {
    const decl = leaf.hiddenOps?.length ? opsFor(leaf.type) : undefined;
    // hiddenOps is set only for a declaration that lists ops, so `create` is present; the guard tells the type checker.
    if (decl?.create) for (const op of leaf.hiddenOps!) out.push({ leaf: opEntry(decl, leaf, op), categoryPath });
    // An op whose formula name differs from its label gets a row that shows that name and places the op
    // ("NORM.DIST → Distributions: Normal"); it wins over the card-level row for the same name.
    const ops = opsFor(leaf.type);
    if (ops?.create) {
      for (const entry of ops.ops) {
        const name = entry.fx?.toUpperCase();
        if (!name || worn.has(name)) continue;
        worn.add(name);
        out.push({ leaf: excelEntry(leaf, entry.fx!, { decl: ops, entry }), categoryPath });
      }
    }
    for (const name of CATALOG_TO_EXCEL.get(leaf.type) ?? []) {
      if (!worn.has(name.toUpperCase())) { worn.add(name.toUpperCase()); out.push({ leaf: excelEntry(leaf, name), categoryPath }); }
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

function bareName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
}

const LEGACY_BY_TARGET = new Map<string, string[]>();
for (const [legacy, target] of Object.entries(LEGACY_ALIASES)) {
  LEGACY_BY_TARGET.set(target, [...(LEGACY_BY_TARGET.get(target) ?? []), legacy]);
}

function legacyNamesOf(names: string[]): string[] {
  return [...new Set(names.flatMap((n) => LEGACY_BY_TARGET.get(n) ?? []))];
}

function typeWords(type: string): string {
  return type.replace(/[-_]/g, " ");
}

const dashes = (s: string) => s.replace(/[\u2010-\u2015]/g, "-");
const WORD_SEP = /[^\p{L}\p{N}.]+/u;

function stripGlyphPrefix(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+\s*/u, "");
}

type Prepared = {
  haystack: string;
  words: string[];
  // Each lowercased field the whole query is scored against, with its penalty.
  fields: [string, number][];
  // Lowercased names a query one typo away still lands on.
  names: string[];
};

// Everything scoreLeaf reads from a leaf but not the query, built once per leaf: the Add menu and the label sweep score every leaf per query.
const prepared = new WeakMap<LeafWithContext, Prepared>();

function prepare(lc: LeafWithContext): Prepared {
  const hit = prepared.get(lc);
  if (hit) return hit;
  const { leaf, categoryPath } = lc;
  const excelNames = CATALOG_TO_EXCEL.get(leaf.type) ?? [];
  const category = categoryPath.join(" ");
  const keywords = leaf.keywords ?? "";
  const haystack = dashes(`${leaf.label} ${excelNames.join(" ")} ${category} ${typeWords(leaf.type)} ${keywords} ${familyOf(leaf)}`).toLowerCase();
  const bare = stripGlyphPrefix(leaf.label);
  const colon = leaf.label.indexOf(": ");
  const opName = colon > 0 && leaf.type.includes("__") ? leaf.label.slice(colon + 2) : null;
  const arrow = leaf.label.indexOf(" → ");
  const aliasName = arrow > 0 && leaf.type.includes("__excel-") ? leaf.label.slice(0, arrow) : null;
  const family = familyOf(leaf);
  // A retired Excel spelling (MATCH, FLOOR.PRECISE) finds the card that answers to its replacement.
  const legacy = legacyNamesOf([...excelNames, bare, ...(opName ? [opName] : [])]);
  const words = dashes(`${leaf.label} ${bare} ${typeWords(leaf.type)} ${keywords} ${category} ${excelNames.join(" ")} ${legacy.join(" ")} ${family}`)
    .toLowerCase().split(WORD_SEP).filter(Boolean);
  const own = [leaf.label, `${leaf.label} ${category}`, typeWords(leaf.type), keywords];
  if (bare && bare !== leaf.label) own.push(bare);
  if (opName) own.push(opName);
  const fields: [string, number][] = [
    ...own.filter((f) => f.trim()).map((f): [string, number] => [f.toLowerCase(), 0]),
    // A row that shows the typed Excel name beats one that only hides it in its keywords, since only one of them shows.
    ...(aliasName ? [[aliasName.toLowerCase(), -5] as [string, number]] : []),
    ...(family ? [[family.toLowerCase(), 5] as [string, number]] : []),
    ...excelNames.map((n): [string, number] => [n.toLowerCase(), 10]),
    ...legacy.map((n): [string, number] => [n.toLowerCase(), 20]),
  ];
  const names = [leaf.label, bare, ...excelNames, ...(aliasName ? [aliasName] : [])].map((n) => n.toLowerCase());
  const p = { haystack, words, fields, names };
  prepared.set(lc, p);
  return p;
}

// The card's family name, the hover hint's ("Table Reshape", "Bessel"), read off the class once per host type.
const families = new Map<string, string>();
function familyOf(leaf: NodeCatalogEntry): string {
  const host = leaf.type.split("__")[0];
  let f = families.get(host);
  if (f === undefined) {
    try { f = nodeTypeName(leaf.create() as { constructor: { name: string } }); } catch { f = ""; }
    families.set(host, f);
  }
  return f;
}

type Query = { tokens: string[]; squashed: string; trimmed: string };

function parseQuery(query: string): Query {
  const lower = dashes(query).toLowerCase();
  return {
    tokens: lower.split(WORD_SEP).filter(Boolean),
    squashed: query.toLowerCase().replace(/\s+/g, ""),
    trimmed: lower.trim(),
  };
}

function scoreLeaf(query: Query, lc: LeafWithContext): number | null {
  const { haystack, words, fields, names } = prepare(lc);
  let s = 0;
  for (const token of query.tokens) {
    const sub = fuzzyScoreLower(token, haystack);
    const word = tokenWordScore(token, words);
    if (sub === null && word === 0) return null;
    s += word >= 90 ? word : (sub ?? 0) + word;
  }
  let bonus = 0;
  for (const [f, penalty] of fields) {
    const fs = fieldScoreLower(query.squashed, f);
    if (fs !== null) bonus = Math.max(bonus, fs - penalty);
  }
  const q = query.trimmed;
  if (q.length >= 4 && names.some((n) => withinOneEdit(q, n))) bonus = Math.max(bonus, 200);
  return s + bonus;
}

/** Best first, one row per thing placed: "SORT → List Sort" and "List Sort" place the same card, so only the better match shows. */
export function searchLeaves(leaves: LeafWithContext[], query: string): NodeCatalogEntry[] {
  const q = parseQuery(query);
  const scored: { leaf: NodeCatalogEntry; score: number }[] = [];
  for (const lc of leaves) {
    const score = scoreLeaf(q, lc);
    if (score !== null) scored.push({ leaf: lc.leaf, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const placed = new Set<string>();
  const out: NodeCatalogEntry[] = [];
  for (const { leaf } of scored) {
    const key = leaf.places ?? leaf.type;
    if (placed.has(key)) continue;
    placed.add(key);
    out.push(leaf);
  }
  return out;
}

type PortLike = { socket?: unknown };
type NodeLike = {
  inputs?: Record<string, PortLike | undefined>;
  outputs?: Record<string, PortLike | undefined>;
};

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

export function filterByCompatibleSocket(
  leaves: LeafWithContext[],
  origin: SolenoidSocket,
  originSide: "input" | "output",
): LeafWithContext[] {
  return leaves.filter((lc) => hasCompatibleSocket(lc.leaf, origin, originSide));
}

export function quickWireCompatibleTypes(
  entries: CatalogEntry[],
  origin: SolenoidSocket,
  originSide: "input" | "output",
): Set<string> {
  return new Set(filterByCompatibleSocket(flattenLeaves(entries), origin, originSide).map((lc) => lc.leaf.type));
}

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
