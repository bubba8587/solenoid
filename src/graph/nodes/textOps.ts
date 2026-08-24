import { base64Encode, base64Decode } from "./hashOps";
import { solError, isSolError, type SolError } from "../errorValue";
// The ONE implementation behind both the visual node and the formula registration.
// Separate from `text.ts` because that imports `excelFunctions` — the other
// direction would cycle and drag rete into the headless formula path.

export type TextAfterBeforeOp = "after" | "before";
export type UrlEncodeOp = "encode" | "decode" | "base64" | "unbase64";
export type RegexOp = "test" | "extract" | "extract_all" | "extract_groups" | "replace";

/** TEXTSPLIT over one string — a BLANK delimiter splits into characters. */
export function splitText(text: string, delimiter: string): string[] {
  return delimiter === "" ? [...text] : text.split(delimiter);
}

/** TEXTAFTER / TEXTBEFORE over one string. A blank delimiter, or one this text
 *  doesn't contain, is a blank (null) rather than the whole string. */
export function textAfterBefore(op: TextAfterBeforeOp, text: string, delimiter: string): string | null {
  if (delimiter === "") return null;
  const idx = text.indexOf(delimiter);
  if (idx === -1) return null;
  return op === "after" ? text.slice(idx + delimiter.length) : text.slice(0, idx);
}

/** ENCODEURL / DECODEURL / ENCODEBASE64 / DECODEBASE64 over one string — a malformed
 *  escape or non-base64 text passes through unchanged. */
export function urlEncode(op: UrlEncodeOp, text: string): string {
  try {
    switch (op) {
      case "encode":   return encodeURIComponent(text);
      case "decode":   return decodeURIComponent(text);
      case "base64":   return base64Encode(text);
      case "unbase64": return base64Decode(text) ?? text;
    }
  } catch {
    return text;
  }
}

export function safeRegex(pattern: string, flags: string): RegExp | null {
  try { return new RegExp(pattern, flags); } catch { return null; }
}

/** One regex op over ONE string. A blank or unparseable pattern is null (blank),
 *  matching the node's whole-output behavior. */
export function regexApply(
  op: RegexOp, text: string, pattern: string, replacement = "", flags = "",
): number | string | string[] | null {
  if (!pattern) return null;
  const re = safeRegex(pattern, flags);
  if (!re) return null;
  // `matchAll` and a global replace both need the g flag; building a fresh RegExp
  // leaves the caller's own `lastIndex` untouched.
  const global = () => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  switch (op) {
    case "test":           return re.test(text) ? 1 : 0;
    case "extract":        return text.match(re)?.[0] ?? "";
    case "extract_all":    return [...text.matchAll(global())].map((m) => m[0]);
    case "extract_groups": return regexGroups(text, pattern, flags);
    case "replace":        return text.replace(global(), replacement);
  }
}

/** Excel REGEXEXTRACT return_mode 2: the FIRST match's capture groups, as a list.
 *  No groups in the pattern (or no match) → empty list. */
export function regexGroups(text: string, pattern: string, flags = ""): string[] | null {
  if (!pattern) return null;
  const re = safeRegex(pattern, flags);
  if (!re) return null;
  const m = text.match(re);
  return m ? m.slice(1).map((g) => g ?? "") : [];
}

/** Excel REGEXREPLACE with a nonzero `occurrence`: replace ONLY the nth match
 *  (1-based). Fewer than n matches → the text unchanged, like Excel. */
export function replaceNth(text: string, pattern: string, replacement: string, n: number, flags = ""): string | null {
  if (!pattern) return null;
  const re = safeRegex(pattern, flags);
  if (!re) return null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let i = 0;
  return text.replace(g, (match, ...rest) => {
    i++;
    if (i !== n) return match;
    // Honor $1-style backreferences by re-running the single-match replace on the
    // matched slice (rest carries groups + offset + string; slice off the tail).
    const offset = rest[rest.length - 2] as number;
    return text.slice(offset, offset + match.length).replace(re, replacement);
  });
}

const SPELL_ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const SPELL_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SPELL_SCALES = ["", " thousand", " million", " billion", " trillion"];

function spellUnder1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${SPELL_ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) {
    const tens = SPELL_TENS[Math.floor(n / 10)];
    parts.push(n % 10 ? `${tens}-${SPELL_ONES[n % 10]}` : tens);
  } else if (n > 0) {
    parts.push(SPELL_ONES[n]);
  }
  return parts.join(" ");
}

/** A whole number with its ordinal suffix: 1 → "1st", 22 → "22nd", 113 → "113th". */
export function ordinalText(n: number): string {
  const i = Math.trunc(n), v = Math.abs(i) % 100;
  const suffix = ["th", "st", "nd", "rd"];
  return `${i}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
}

/** English cardinal words for any |n| < 10^15. Exported for tests. */
export function spellNumber(n: number): string | SolError {
  if (!Number.isFinite(n)) return solError("#DOMAIN!", "Not a finite number");
  if (Math.abs(n) >= 1e15) return solError("#DOMAIN!", "Spell Number goes up to the trillions");
  const neg = n < 0;
  const abs = Math.abs(n);
  const int = Math.floor(abs);

  let words: string;
  if (int === 0) {
    words = "zero";
  } else {
    // Split into 3-digit groups, spell each with its scale word.
    const groups: string[] = [];
    let rest = int, scale = 0;
    while (rest > 0) {
      const g = rest % 1000;
      if (g > 0) groups.unshift(spellUnder1000(g) + SPELL_SCALES[scale]);
      rest = Math.floor(rest / 1000);
      scale++;
    }
    words = groups.join(" ");
  }

  // Decimal digits read one by one; cap at 6 to dodge float dust.
  const fracText = String(abs).includes(".") ? String(abs).split(".")[1].slice(0, 6) : "";
  if (fracText) words += ` point ${[...fracText].map((d) => SPELL_ONES[Number(d)]).join(" ")}`;

  return neg ? `negative ${words}` : words;
}

/** Reverse a string — famously impossible in an Excel formula. */
export function reverseText(t: string): string {
  return [...t].reverse().join("");
}

export type TextFilterOp = "contains" | "not_contains" | "starts_with" | "ends_with";
export const TEXT_FILTER_OPS: readonly TextFilterOp[] = ["contains", "not_contains", "starts_with", "ends_with"];

/** Keep the strings matching the condition — case-insensitive (excelComparisons: comparisons
 *  match like Excel's `=`), the Text Filter node's semantics on both surfaces
 *  (TEXTFILTER runs this same kernel). */
export function filterTextList(strings: readonly string[], pattern: string, op: TextFilterOp): string[] {
  const p = pattern.toLowerCase();
  const has = (s: string) => s.toLowerCase().includes(p);
  switch (op) {
    case "contains":     return strings.filter(has);
    case "not_contains": return strings.filter((s) => !has(s));
    case "starts_with":  return strings.filter((s) => s.toLowerCase().startsWith(p));
    case "ends_with":    return strings.filter((s) => s.toLowerCase().endsWith(p));
  }
}

// ─── String distance / similarity (rapidfuzz, R stringdist, Excel's Fuzzy Lookup) ────
export type SimilarityMethod = "ratio" | "levenshtein" | "damerau" | "jaro_winkler";

/** Levenshtein edit distance (insert / delete / substitute), by code point. */
export function levenshtein(a: string, b: string): number {
  const s = [...a], t = [...b];
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

/** Damerau–Levenshtein (optimal string alignment): Levenshtein plus adjacent transposition. */
export function damerauLevenshtein(a: string, b: string): number {
  const s = [...a], t = [...b];
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) => [i, ...new Array<number>(t.length).fill(0)]);
  for (let j = 0; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++) for (let j = 1; j <= t.length; j++) {
    const cost = s[i - 1] === t[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[s.length][t.length];
}

/** Jaro–Winkler similarity 0–1 (prefix scale 0.1, up to 4 chars) — the record-linkage standard. */
export function jaroWinkler(a: string, b: string): number {
  const s = [...a], t = [...b];
  if (s.length === 0 && t.length === 0) return 1;
  if (s.length === 0 || t.length === 0) return 0;
  const range = Math.max(0, Math.floor(Math.max(s.length, t.length) / 2) - 1);
  const sm = new Array<boolean>(s.length).fill(false), tm = new Array<boolean>(t.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(t.length, i + range + 1); j++) {
      if (!tm[j] && s[i] === t[j]) { sm[i] = tm[j] = true; matches++; break; }
    }
  }
  if (matches === 0) return 0;
  let trans = 0, k = 0;
  for (let i = 0; i < s.length; i++) {
    if (!sm[i]) continue;
    while (!tm[k]) k++;
    if (s[i] !== t[k]) trans++;
    k++;
  }
  const jaro = (matches / s.length + matches / t.length + (matches - trans / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s.length, t.length) && s[i] === t[i]; i++) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similarity 0–1 by method: `ratio` = 1 − Levenshtein/maxlen (rapidfuzz's normalized
 *  Levenshtein; R stringsim), `damerau` the same with transpositions, `jaro_winkler` as is;
 *  `levenshtein` answers the raw DISTANCE (an integer, not 0–1). Case-sensitive; trim and
 *  lower-case upstream (Clean Whitespace / LOWER) when that is the intent. */
export function textSimilarity(a: string, b: string, method: SimilarityMethod = "ratio"): number {
  if (method === "levenshtein") return levenshtein(a, b);
  if (method === "jaro_winkler") return jaroWinkler(a, b);
  const maxLen = Math.max([...a].length, [...b].length);
  if (maxLen === 0) return 1;
  const dist = method === "damerau" ? damerauLevenshtein(a, b) : levenshtein(a, b);
  return 1 - dist / maxLen;
}

/** The best-matching candidate for `needle` (highest similarity, first on ties) with its
 *  score; `null` when nothing clears the threshold or there are no candidates. */
export function fuzzyBest(needle: string, candidates: readonly string[], method: SimilarityMethod = "ratio", threshold = 0):
  { index: number; text: string; score: number } | null {
  let best: { index: number; text: string; score: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const score = textSimilarity(needle, candidates[i], method === "levenshtein" ? "ratio" : method);
    if (score >= threshold && (best === null || score > best.score)) best = { index: i, text: candidates[i], score };
  }
  return best;
}

// Letters NFD can't decompose (no combining mark) get an ASCII spelling — the
// unidecode / iconv TRANSLIT convention.
const TRANSLIT: Record<string, string> = {
  "ß": "ss", "æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "œ": "oe", "Œ": "OE", "đ": "d", "Đ": "D",
  "ł": "l", "Ł": "L", "ð": "d", "Ð": "D", "þ": "th", "Þ": "TH", "ı": "i", "ŋ": "ng", "Ŋ": "NG",
};
/** Strip diacritics: "Crème Brûlée" → "Creme Brulee". unidecode, R stringi::stri_trans_general(…, "Latin-ASCII"), iconv TRANSLIT. */
export function unaccent(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ßæÆøØœŒđĐłŁðÐþÞıŋŊ]/g, (c) => TRANSLIT[c] ?? c);
}

/** URL/filename slug: unaccent, lowercase, every non-alphanumeric run → `sep`, trimmed.
 *  python-slugify, R janitor::make_clean_names. */
export function slugify(t: string, sep = "-"): string {
  const body = unaccent(t).toLowerCase().replace(/[^a-z0-9]+/g, sep);
  if (!sep) return body;
  const esc = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`^(?:${esc})+|(?:${esc})+$`, "g"), "");
}

export type PadSide = "left" | "right" | "center";
/** Pad to `width` code points; `side` is where the padding GOES (R str_pad, pandas
 *  str.pad; Python rjust = left, ljust = right). `fill` cycles; text already at least
 *  `width` long is unchanged. */
export function padText(t: string, width: number, side: PadSide, fill = " "): string {
  const chars = [...t];
  const w = Math.max(0, Math.floor(width));
  const f = [...(fill === "" ? " " : fill)];
  if (chars.length >= w) return t;
  const need = w - chars.length;
  const run = (n: number) => Array.from({ length: n }, (_, i) => f[i % f.length]).join("");
  if (side === "left") return run(need) + t;
  if (side === "right") return t + run(need);
  const left = Math.floor(need / 2);
  return run(left) + t + run(need - left);
}

/** Cut to at most `width` code points, ending in `ellipsis` when anything was cut
 *  (R str_trunc, textwrap.shorten). */
export function truncateText(t: string, width: number, ellipsis = "…"): string {
  const chars = [...t];
  const w = Math.max(0, Math.floor(width));
  if (chars.length <= w) return t;
  const e = [...ellipsis];
  const keep = Math.max(0, w - e.length);
  return chars.slice(0, keep).join("") + (keep === 0 ? e.slice(0, w).join("") : ellipsis);
}

/** Greedy word-wrap on whitespace to at most `width` code points per line (R
 *  `str_wrap`, Python `textwrap.wrap`): words join with single spaces, runs of
 *  whitespace collapse, and a single word longer than `width` sits alone on its
 *  line unbroken. `width` clamps to 1; empty or blank text → `[]`. */
export function wrapText(t: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  const words = t.split(/\s+/).filter((s) => s !== "");
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  let lineLen = 0;
  for (const word of words) {
    const wordLen = [...word].length;
    if (line === "") { line = word; lineLen = wordLen; continue; }
    if (lineLen + 1 + wordLen <= w) { line += " " + word; lineLen += 1 + wordLen; }
    else { lines.push(line); line = word; lineLen = wordLen; }
  }
  lines.push(line);
  return lines;
}

// ─── Template: "Hello {name}, total {total:0.00}" (str_glue, f-strings, str.format) ───
// `{{` / `}}` are literal braces; a placeholder is `{name}` or `{name:spec}` where
// spec is an Excel TEXT format code (or a date format) handed to the caller's `fmt`.
const TEMPLATE_TOKEN = /\{\{|\}\}|\{\s*([A-Za-z_][\w .-]*?|\d+)\s*(?::([^{}]*))?\}/g;

/** Distinct placeholder names, in first-appearance order. */
export function templatePlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TEMPLATE_TOKEN)) {
    const name = m[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Substitute every placeholder through `lookup` + `fmt` (which decides how a number,
 *  date, logical or blank prints, with the optional spec). */
export function renderTemplate(
  template: string,
  lookup: (name: string) => unknown,
  fmt: (value: unknown, name: string, spec: string | undefined) => string,
): string {
  return template.replace(TEMPLATE_TOKEN, (tok, name: string | undefined, spec: string | undefined) => {
    if (tok === "{{") return "{";
    if (tok === "}}") return "}";
    return fmt(lookup(name!), name!, spec === undefined ? undefined : spec.trim() || undefined);
  });
}

export interface TemplateFormatters {
  /** A number with an optional TEXT-style spec (General when absent). */
  number: (v: number, spec: string | undefined) => string;
  /** A date serial with an optional date format. */
  date?: (v: number, spec: string | undefined) => string;
}
/** The value a placeholder prints as: numbers via the injected formatter, a date-typed
 *  input via the date one, logicals as TRUE/FALSE, a blank as "", an error as its code. */
export function templateFormat(value: unknown, spec: string | undefined, f: TemplateFormatters, isDate = false): string {
  if (value === null || value === undefined) return "";
  if (isSolError(value)) return value.code;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return isDate && f.date ? f.date(value, spec) : f.number(value, spec);
  if (Array.isArray(value)) return value.map((v) => templateFormat(v, spec, f, isDate)).join(", ");
  return String(value);
}
