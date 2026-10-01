// [[C114]] cardsView, [[C103]] untrustedContentSeams
import { decimalFromText } from "./valueKinds";
import { cellImageSrc } from "./recordLayout";

export type CardColType = "number" | "string" | "date" | "logical";

export interface CardColumnInput {
  name: string;
  type: CardColType;
  /** The raw text of each row's cell, in source order; blank is "". */
  cells: readonly string[];
  /** Each row's cell as the popup shows it (format picks applied), when it differs from `cells`. */
  shown?: readonly string[];
  /** The column's format is the Chip style. */
  chip?: boolean;
}

export interface CardMeter { col: number; max: number }

/** Column indices by the part of the card they fill; every column lands in exactly one part. */
export interface CardPlan {
  image: number | null;
  key: number | null;
  title: number | null;
  /** Columns joined after the title with a space: a Last Name after a First Name. */
  titleRest: number[];
  subtitle: number | null;
  meta: number | null;
  /** The end of a date range whose start is `meta`. */
  metaEnd: number | null;
  hero: number | null;
  chips: number[];
  tags: number[];
  swatches: number[];
  flags: number[];
  ratings: number[];
  meters: CardMeter[];
  stats: number[];
  prose: number[];
}

// The profile reads a bounded prefix, so opening a huge frame stays cheap; the plan is still a pure function of the cells.
export const PROFILE_ROWS = 2000;

const PROSE_AVG = 40;
const PROSE_MAX = 90;
const PROSE_NAMED_AVG = 20;
const CHIP_MAX_LEN = 24;
const CHIP_MAX_DISTINCT = 8;
const TITLE_MAX_AVG = 40;
const KEY_MAX_LEN = 16;

const KEY_WORDS = new Set(["id", "#", "no", "sku", "uuid", "key", "ref", "code", "idx", "index", "isbn"]);
const KEY_LAST_WORDS = new Set(["id", "no", "num", "number", "code", "ref", "sku", "#"]);
const TITLE_WORDS = new Set([
  "name", "title", "label", "item", "product", "subject", "person", "customer", "client",
  "company", "city", "country", "task", "project", "heading", "username", "user", "contact",
  "employee", "student", "member", "team", "place", "venue", "event", "song", "book", "film", "movie",
  "nickname", "model", "brand", "recipe", "dish", "vehicle", "species", "plant", "animal", "game",
  "album", "artist", "track", "episode", "show", "location", "store", "shop", "vendor", "supplier",
  "account", "asset", "part", "device", "host", "server", "service", "feature", "issue", "ticket",
  "milestone", "goal", "habit", "campaign", "course", "school", "hotel", "restaurant", "destination",
  "trip", "organization", "organisation", "org", "business", "character", "player", "author",
]);
const FIRST_NAME = (w: string[]) => w.includes("first") || w.includes("given") || w.includes("forename");
const MIDDLE_NAME = (w: string[]) => w.includes("middle");
const LAST_NAME = (w: string[]) => w.includes("last") || w.includes("family") || w.includes("surname");
const PROSE_WORDS = new Set([
  "description", "desc", "notes", "note", "comments", "comment", "summary", "bio", "about", "details",
  "remarks", "memo", "abstract", "body", "message", "review", "feedback", "instructions", "synopsis",
]);
const TAG_WORDS = new Set(["tags", "tag", "labels", "keywords", "categories", "skills", "topics", "genres", "genre"]);
const RATING_WORDS = new Set(["rating", "ratings", "stars", "star"]);
const METER_WORDS = new Set([
  "progress", "percent", "percentage", "pct", "completion", "complete", "completed", "done", "share",
  "probability", "confidence", "utilization", "utilisation", "usage", "coverage", "battery",
  "humidity", "occupancy", "attendance", "accuracy",
]);
const START_WORDS = new Set(["start", "starts", "from", "begin", "begins", "checkin", "departure", "depart", "opened", "open"]);
const END_WORDS = new Set(["end", "ends", "to", "until", "finish", "finished", "due", "checkout", "return", "closed", "close"]);
// Earlier words win: a Total outranks a Price on the same row.
const HERO_WORDS = [
  "total", "grand", "subtotal", "amount", "balance", "net", "gross", "revenue", "sales", "income",
  "profit", "earnings", "due", "paid", "salary", "pay", "budget", "price", "cost", "fee", "rent",
  "expense", "spend", "spent", "value", "worth", "valuation", "score", "points", "sum",
];

const CODE_RE = /^[a-z]{0,5}[-_ #/]?\d{1,10}$/i;
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
const CURRENCY_RE = /[$€£¥₹₩₽₺₫₪฿]/;
const TAG_SPLIT = /\s*[,;]\s*/;

/** Lowercase words of a column name, split at spaces, punctuation and camelCase humps; `#` survives as a word. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9#]+/)
    .filter((w) => w !== "");
}

export function isHexColor(text: string): boolean {
  return HEX_RE.test(text.trim());
}

export function splitTags(text: string): string[] {
  return text.split(TAG_SPLIT).map((t) => t.trim()).filter((t) => t !== "");
}

/** The address a cell's text links to: an http(s) URL as it is, an email address as `mailto:`; anything else null. */
export function linkHref(text: string): string | null {
  const t = text.trim();
  if (URL_RE.test(t)) return t;
  if (EMAIL_RE.test(t)) return `mailto:${t}`;
  return null;
}

/** A URL shortened for a narrow card: no scheme, no `www.`, no trailing slash, and a long path cut to its first part. */
export function shortLink(url: string): string {
  const bare = url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  if (bare.length <= 32) return bare;
  const slash = bare.indexOf("/");
  if (slash < 0) return bare.slice(0, 31) + "…";
  const host = bare.slice(0, slash);
  const firstPart = bare.slice(slash + 1).split(/[/?#]/)[0];
  const short = firstPart ? `${host}/${firstPart}` : host;
  return short.length < bare.length ? `${short.slice(0, 31)}…` : short;
}

interface Profile {
  filled: number;
  distinct: number;
  avgLen: number;
  maxLen: number;
  images: number;
  urls: number;
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
  hexColors: boolean;
  min: number;
  max: number;
  /** Every filled cell shows with a `%`. */
  shownPercent: boolean;
  /** Every filled cell shows with a currency sign. */
  shownCurrency: boolean;
}

function profile(col: CardColumnInput): Profile {
  const n = Math.min(col.cells.length, PROFILE_ROWS);
  const seen = new Set<string>();
  let filled = 0, total = 0, maxLen = 0, images = 0, urls = 0;
  let ints = true, yearLike = true, codes = true, hexColors = true, shownPercent = true, shownCurrency = true;
  let counting = n > 1;
  let prev: number | null = null;
  let min = Infinity, max = -Infinity;
  for (let r = 0; r < n; r++) {
    const t = col.cells[r].trim();
    if (t === "") { counting = false; continue; }
    filled++;
    seen.add(t);
    total += t.length;
    if (t.length > maxLen) maxLen = t.length;
    if (!CODE_RE.test(t)) codes = false;
    if (!HEX_RE.test(t)) hexColors = false;
    if (col.type === "string") {
      if (cellImageSrc(t)) images++;
      else if (URL_RE.test(t)) urls++;
    }
    const s = (col.shown?.[r] ?? t).trim();
    if (!s.endsWith("%")) shownPercent = false;
    if (!CURRENCY_RE.test(s)) shownCurrency = false;
    if (col.type === "number") {
      const v = decimalFromText(t);
      if (v < min) min = v;
      if (v > max) max = v;
      const isInt = Number.isInteger(v);
      if (!isInt) ints = false;
      if (!isInt || v < 1800 || v > 2200) yearLike = false;
      if (!isInt || (prev !== null && v !== prev + 1)) counting = false;
      prev = v;
    }
  }
  const numeric = col.type === "number" && filled > 0 && Number.isFinite(min) && Number.isFinite(max);
  return {
    filled,
    distinct: seen.size,
    avgLen: filled ? total / filled : 0,
    maxLen,
    images,
    urls,
    ints: numeric && ints,
    unique: seen.size === filled,
    counting: numeric && counting,
    yearLike: numeric && yearLike,
    codes: col.type === "string" && filled > 0 && codes,
    hexColors: col.type === "string" && filled > 0 && hexColors,
    min: numeric ? min : NaN,
    max: numeric ? max : NaN,
    shownPercent: filled > 0 && shownPercent,
    shownCurrency: filled > 0 && shownCurrency,
  };
}

function isKeyName(words: string[]): boolean {
  if (words.length === 0) return false;
  if (words.length === 1) return KEY_WORDS.has(words[0]);
  return KEY_LAST_WORDS.has(words[words.length - 1]);
}

function heroRank(words: string[]): number {
  let best = Infinity;
  for (const w of words) {
    const i = HERO_WORDS.indexOf(w);
    if (i >= 0 && i < best) best = i;
  }
  return best;
}

const has = (words: string[], set: ReadonlySet<string>) => words.some((w) => set.has(w));

/**
 * Which part of a card each column fills. Deterministic: it reads only the names, types and
 * cells, and every tie goes to the column further left. The rules and their order are the
 * table-popup spec § The Cards view.
 */
export function planCards(cols: readonly CardColumnInput[]): CardPlan {
  const profiles = cols.map(profile);
  const words = cols.map((c) => nameWords(c.name));
  const rows = cols.reduce((m, c) => Math.max(m, Math.min(c.cells.length, PROFILE_ROWS)), 0);
  const taken = new Set<number>();
  const take = (i: number | null): number | null => { if (i !== null) taken.add(i); return i; };
  const takeAll = (is: number[]): number[] => { is.forEach((i) => taken.add(i)); return is; };
  const free = (pred: (i: number) => boolean): number[] =>
    cols.flatMap((_, i) => (!taken.has(i) && profiles[i].filled > 0 && pred(i) ? [i] : []));
  const first = (pred: (i: number) => boolean): number | null => free(pred)[0] ?? null;

  const isText = (i: number) => cols[i].type === "string";
  const isNum = (i: number) => cols[i].type === "number";
  const isDate = (i: number) => cols[i].type === "date";
  const isLinks = (i: number) => profiles[i].urls * 2 >= profiles[i].filled && profiles[i].urls > 0;
  const isImages = (i: number) => profiles[i].images * 2 >= profiles[i].filled && profiles[i].images > 0;
  const isPlainText = (i: number) => isText(i) && !isLinks(i) && !isImages(i);

  const image = take(first((i) => isText(i) && isImages(i)));
  const swatches = takeAll(free((i) => profiles[i].hexColors));

  const key = take(first((i) => {
    const p = profiles[i];
    if (!p.unique) return false;
    if (isNum(i)) return p.ints && (isKeyName(words[i]) || (i === 0 && p.counting));
    return isText(i) && (isKeyName(words[i]) || (p.codes && !has(words[i], TITLE_WORDS))) && p.maxLen <= KEY_MAX_LEN;
  }));

  const firstName = first((i) => isText(i) && FIRST_NAME(words[i]) && words[i].includes("name"));
  const lastName = firstName === null ? null : first((i) => isText(i) && LAST_NAME(words[i]) && words[i].includes("name"));
  const middleName = lastName === null ? null : first((i) => isText(i) && MIDDLE_NAME(words[i]) && words[i].includes("name"));
  let title: number | null = null;
  let titleRest: number[] = [];
  if (firstName !== null && lastName !== null) {
    title = take(firstName);
    titleRest = takeAll(middleName !== null ? [middleName, lastName] : [lastName]);
  }

  const tags = takeAll(free((i) => isPlainText(i) && has(words[i], TAG_WORDS) && profiles[i].maxLen <= PROSE_MAX));

  const prose = takeAll(free((i) => {
    if (!isPlainText(i)) return false;
    const p = profiles[i];
    return p.avgLen > PROSE_AVG || p.maxLen > PROSE_MAX || (has(words[i], PROSE_WORDS) && p.avgLen > PROSE_NAMED_AVG);
  }));

  const chipCap = Math.max(2, Math.min(CHIP_MAX_DISTINCT, Math.floor(rows / 2)));
  const chips = takeAll(free((i) => {
    if (!isPlainText(i)) return false;
    if (cols[i].chip) return true;
    const p = profiles[i];
    return rows >= 3 && p.distinct <= chipCap && p.distinct < p.filled && p.maxLen <= CHIP_MAX_LEN;
  }));

  if (title === null) {
    let bestScore = -1;
    // A surname alone is half a name: without its First Name partner it takes no name bonus.
    const nameLike = (i: number) => has(words[i], TITLE_WORDS) && !(LAST_NAME(words[i]) || MIDDLE_NAME(words[i]));
    for (const i of free((j) => isPlainText(j) && profiles[j].avgLen <= TITLE_MAX_AVG)) {
      const p = profiles[i];
      const ratio = p.distinct / p.filled;
      const score =
        (nameLike(i) ? 4 : 0) +
        (ratio >= 0.9 ? 2 : ratio >= 0.5 ? 1 : 0) +
        (p.avgLen >= 2 && p.avgLen <= 32 ? 1 : 0);
      if (score > bestScore) { bestScore = score; title = i; }
    }
    take(title);
  }

  const subtitle = title === null ? null : take(first((i) => isPlainText(i) && profiles[i].avgLen <= PROSE_AVG));

  let meta = take(first(isDate));
  let metaEnd: number | null = null;
  if (meta !== null && has(words[meta], START_WORDS)) metaEnd = take(first((i) => isDate(i) && has(words[i], END_WORDS)));
  if (meta === null) meta = take(first((i) => isNum(i) && profiles[i].yearLike && words[i].includes("year")));

  const ratings = takeAll(free((i) => isNum(i) && has(words[i], RATING_WORDS) && profiles[i].min >= 0 && profiles[i].max <= 5));

  const meters = free((i) => {
    if (!isNum(i)) return false;
    const p = profiles[i];
    if (p.min < 0) return false;
    if (p.shownPercent) return true;
    const named = has(words[i], METER_WORDS) || cols[i].name.includes("%");
    return named && p.max <= 100;
  }).map((col): CardMeter => ({ col, max: profiles[col].shownPercent || profiles[col].max <= 1 ? 1 : 100 }));
  meters.forEach((m) => taken.add(m.col));

  const heroPool = free(isNum);
  let hero: number | null = null;
  let bestRank = Infinity;
  for (const i of heroPool) {
    const r = heroRank(words[i]);
    if (r < bestRank) { bestRank = r; hero = i; }
  }
  if (hero === null) hero = heroPool.find((i) => profiles[i].shownCurrency) ?? null;
  if (hero === null) hero = [...heroPool].reverse().find((i) => !profiles[i].yearLike && !isKeyName(words[i])) ?? null;
  take(hero);

  const flags = takeAll(free((i) => cols[i].type === "logical"));

  const stats = cols.flatMap((_, i) => (taken.has(i) ? [] : [i]));

  return { image, key, title, titleRest, subtitle, meta, metaEnd, hero, chips, tags, swatches, flags, ratings, meters, stats, prose };
}

/** Case-insensitive: does any of the row's shown texts contain every word of the query? */
export function cardMatches(texts: readonly string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = texts.join("\u0001").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
