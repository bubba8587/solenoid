// [[D88]] cardsView
import { decimalFromText } from "./valueKinds";
import { recordImageSrc } from "./recordLayout";

export type CardColType = "number" | "string" | "date" | "logical";

export interface CardColumnInput {
  name: string;
  type: CardColType;
  /** The raw text of each row's cell, in source order; blank is "". */
  cells: readonly string[];
  /** The column's format is the Chip style. */
  chip?: boolean;
}

/** Column indices by the part of the card they fill; every column lands in exactly one part. */
export interface CardPlan {
  image: number | null;
  key: number | null;
  title: number | null;
  subtitle: number | null;
  meta: number | null;
  hero: number | null;
  chips: number[];
  flags: number[];
  stats: number[];
  prose: number[];
}

// The profile reads a bounded prefix, so opening a huge frame stays cheap; the plan is still a pure function of the cells.
export const PROFILE_ROWS = 2000;

const PROSE_AVG = 40;
const PROSE_MAX = 90;
const CHIP_MAX_LEN = 24;
const CHIP_MAX_DISTINCT = 8;
const TITLE_MAX_AVG = 40;
const KEY_MAX_LEN = 16;

const KEY_WORDS = new Set(["id", "#", "no", "sku", "uuid", "key", "ref", "code", "idx", "index"]);
const TITLE_WORDS = new Set([
  "name", "title", "label", "item", "product", "subject", "person", "customer", "client",
  "company", "city", "country", "task", "project", "heading", "username", "user", "contact",
  "employee", "student", "member", "team", "place", "venue", "event", "song", "book", "film", "movie",
]);
// Earlier words win: a Total outranks a Price on the same row.
const HERO_WORDS = [
  "total", "grand", "amount", "balance", "net", "revenue", "sales", "profit", "due", "paid",
  "salary", "pay", "budget", "price", "cost", "value", "score", "sum",
];

/** Lowercase words of a column name, split at spaces, punctuation and camelCase humps; `#` survives as a word. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9#]+/)
    .filter((w) => w !== "");
}

interface Profile {
  filled: number;
  distinct: number;
  avgLen: number;
  maxLen: number;
  images: number;
  /** Every filled cell reads as an integer. */
  ints: boolean;
  /** No filled value repeats. */
  unique: boolean;
  /** Every cell is filled and counts up by one from the first. */
  counting: boolean;
  /** Integers between 1800 and 2200: a year, never the headline number. */
  yearLike: boolean;
  /** Every filled cell reads like an order or invoice code: `SO-1042`, `A12`, `#77`. */
  codes: boolean;
}

const CODE_RE = /^[a-z]{0,5}[-_ #/]?\d{1,10}$/i;

function profile(col: CardColumnInput): Profile {
  const cells = col.cells.length > PROFILE_ROWS ? col.cells.slice(0, PROFILE_ROWS) : col.cells;
  const seen = new Set<string>();
  let filled = 0, total = 0, maxLen = 0, images = 0;
  let ints = true, yearLike = true, codes = true, counting = cells.length > 1;
  let prev: number | null = null;
  for (const raw of cells) {
    const t = raw.trim();
    if (t === "") { counting = false; continue; }
    filled++;
    seen.add(t);
    total += t.length;
    if (t.length > maxLen) maxLen = t.length;
    if (col.type === "string" && recordImageSrc(t)) images++;
    if (!CODE_RE.test(t)) codes = false;
    if (col.type === "number") {
      const n = decimalFromText(t);
      const isInt = Number.isInteger(n);
      if (!isInt) ints = false;
      if (!isInt || n < 1800 || n > 2200) yearLike = false;
      if (!isInt || (prev !== null && n !== prev + 1)) counting = false;
      prev = n;
    }
  }
  if (col.type !== "number" || filled === 0) { ints = false; yearLike = false; counting = false; }
  return {
    filled,
    distinct: seen.size,
    avgLen: filled ? total / filled : 0,
    maxLen,
    images,
    ints,
    unique: seen.size === filled,
    counting,
    yearLike,
    codes: col.type === "string" && filled > 0 && codes,
  };
}

function isKeyName(words: string[]): boolean {
  if (words.length === 0) return false;
  if (words.length === 1) return KEY_WORDS.has(words[0]);
  return words[words.length - 1] === "id";
}

function heroRank(words: string[]): number {
  let best = Infinity;
  for (const w of words) {
    const i = HERO_WORDS.indexOf(w);
    if (i >= 0 && i < best) best = i;
  }
  return best;
}

/**
 * Which part of a card each column fills. Deterministic: it reads only the names, types and
 * cells, and every tie goes to the column further left.
 */
export function planCards(cols: readonly CardColumnInput[]): CardPlan {
  const profiles = cols.map(profile);
  const words = cols.map((c) => nameWords(c.name));
  const rows = cols.reduce((m, c) => Math.max(m, Math.min(c.cells.length, PROFILE_ROWS)), 0);
  const taken = new Set<number>();
  const take = (i: number | null): number | null => { if (i !== null) taken.add(i); return i; };
  const free = (pred: (i: number) => boolean): number[] =>
    cols.flatMap((_, i) => (!taken.has(i) && pred(i) ? [i] : []));
  const first = (pred: (i: number) => boolean): number | null => free(pred)[0] ?? null;

  const isText = (i: number) => cols[i].type === "string";
  const isNum = (i: number) => cols[i].type === "number";

  const image = take(first((i) => isText(i) && profiles[i].images > 0 && profiles[i].images * 2 >= profiles[i].filled));

  const key = take(first((i) => {
    const p = profiles[i];
    if (p.filled === 0 || !p.unique) return false;
    if (isNum(i)) return p.ints && (isKeyName(words[i]) || (i === 0 && p.counting));
    return isText(i) && (isKeyName(words[i]) || p.codes) && p.maxLen <= KEY_MAX_LEN;
  }));

  const prose = free((i) => isText(i) && (profiles[i].avgLen > PROSE_AVG || profiles[i].maxLen > PROSE_MAX));
  prose.forEach((i) => taken.add(i));

  const chipCap = Math.max(2, Math.min(CHIP_MAX_DISTINCT, Math.floor(rows / 2)));
  const chips = free((i) => {
    if (!isText(i)) return false;
    if (cols[i].chip) return true;
    const p = profiles[i];
    return rows >= 3 && p.filled > 0 && p.distinct <= chipCap && p.distinct < p.filled && p.maxLen <= CHIP_MAX_LEN;
  });
  chips.forEach((i) => taken.add(i));

  let title: number | null = null;
  let bestScore = -1;
  for (const i of free((j) => isText(j) && profiles[j].filled > 0 && profiles[j].avgLen <= TITLE_MAX_AVG)) {
    const p = profiles[i];
    const ratio = p.distinct / p.filled;
    const score =
      (words[i].some((w) => TITLE_WORDS.has(w)) ? 4 : 0) +
      (ratio >= 0.9 ? 2 : ratio >= 0.5 ? 1 : 0) +
      (p.avgLen >= 2 && p.avgLen <= 32 ? 1 : 0);
    if (score > bestScore) { bestScore = score; title = i; }
  }
  take(title);

  const subtitle = title === null ? null : take(first((i) => isText(i) && profiles[i].filled > 0 && profiles[i].avgLen <= PROSE_AVG));

  const meta = take(first((i) => cols[i].type === "date" && profiles[i].filled > 0));

  const heroPool = free((i) => isNum(i) && profiles[i].filled > 0);
  let hero: number | null = null;
  let bestRank = Infinity;
  for (const i of heroPool) {
    const r = heroRank(words[i]);
    if (r < bestRank) { bestRank = r; hero = i; }
  }
  if (hero === null) hero = [...heroPool].reverse().find((i) => !profiles[i].yearLike) ?? null;
  take(hero);

  const flags = free((i) => cols[i].type === "logical");
  flags.forEach((i) => taken.add(i));

  const stats = free(() => true);

  return { image, key, title, subtitle, meta, hero, chips, flags, stats, prose };
}

/** Case-insensitive: does any of the row's shown texts contain every word of the query? */
export function cardMatches(texts: readonly string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = texts.join("\u0001").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
