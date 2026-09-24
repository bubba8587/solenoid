// [[D5]] searchWiderThanLabel, [[C19]] namingModel
import { CATALOG_TO_EXCEL } from "./excelToCatalog";
import { LEGACY_ALIASES } from "./excelFunctions";
import { fuzzyScore, fieldScore, tokenWordScore, withinOneEdit } from "./fuzzy";
import { opsFor, opEntry, excelEntry } from "./nodeOps";
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
    for (const name of CATALOG_TO_EXCEL.get(leaf.type) ?? []) {
      if (!worn.has(name.toUpperCase())) out.push({ leaf: excelEntry(leaf, name), categoryPath });
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

export function scoreLeaf(query: string, { leaf, categoryPath }: LeafWithContext): number | null {
  const excelNames = CATALOG_TO_EXCEL.get(leaf.type) ?? [];
  const category = categoryPath.join(" ");
  const keywords = leaf.keywords ?? "";
  const haystack = dashes(`${leaf.label} ${leaf.description ?? ""} ${excelNames.join(" ")} ${category} ${typeWords(leaf.type)} ${keywords}`);
  const bare = stripGlyphPrefix(leaf.label);
  const colon = leaf.label.indexOf(": ");
  const opName = colon > 0 && leaf.type.includes("__") ? leaf.label.slice(colon + 2) : null;
  // A retired Excel spelling (MATCH, FLOOR.PRECISE) finds the card that answers to its replacement.
  const legacy = legacyNamesOf([...excelNames, bare, ...(opName ? [opName] : [])]);
  const words = dashes(`${leaf.label} ${bare} ${typeWords(leaf.type)} ${keywords} ${category} ${excelNames.join(" ")} ${legacy.join(" ")}`)
    .toLowerCase().split(WORD_SEP).filter(Boolean);
  let s = 0;
  for (const token of dashes(query).toLowerCase().split(WORD_SEP)) {
    if (!token) continue;
    const sub = fuzzyScore(token, haystack);
    const word = tokenWordScore(token, words);
    if (sub === null && word === 0) return null;
    s += word >= 90 ? word : (sub ?? 0) + word;
  }
  const fields = [leaf.label, `${leaf.label} ${category}`, typeWords(leaf.type), keywords];
  if (bare && bare !== leaf.label) fields.push(bare);
  if (opName) fields.push(opName);
  let bonus = 0;
  for (const f of fields) {
    const fs = f.trim() ? fieldScore(query, f) : null;
    if (fs !== null) bonus = Math.max(bonus, fs);
  }
  for (const name of excelNames) {
    const fs = fieldScore(query, name);
    if (fs !== null) bonus = Math.max(bonus, fs - 10);
  }
  for (const name of legacy) {
    const fs = fieldScore(query, name);
    if (fs !== null) bonus = Math.max(bonus, fs - 20);
  }
  const q = dashes(query).toLowerCase().trim();
  if (q.length >= 4 && [leaf.label, bare, ...excelNames].some((n) => withinOneEdit(q, n.toLowerCase()))) bonus = Math.max(bonus, 200);
  return s + bonus;
}

export function searchLeaves(leaves: LeafWithContext[], query: string): NodeCatalogEntry[] {
  const scored: { leaf: NodeCatalogEntry; score: number }[] = [];
  for (const lc of leaves) {
    const score = scoreLeaf(query, lc);
    if (score !== null) scored.push({ leaf: lc.leaf, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((x) => x.leaf);
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
