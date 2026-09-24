// [[C17]] shareImpl
// Must not import `text.ts` (it imports `excelFunctions`; the cycle would drag rete into the formula path).
import { base64Encode, base64Decode } from "./hashOps";
import { solError, isSolError, type SolError } from "../errorValue";
import { decimalFromText } from "../valueKinds";

export type TextAfterBeforeOp = "after" | "before";
export type UrlEncodeOp = "encode" | "decode" | "base64" | "unbase64";
export type RegexOp = "test" | "extract" | "extract_all" | "extract_groups" | "replace";

/** VALUE's text reading, shared by the formula and Cast ([[B16]] oneFormulaSurface): `decimalFromText` after the currency, percent and parenthesis marks. */
export function parseValueText(text: string): number {
  let t = text.trim(), pct = 0, neg = false;
  while (t.endsWith("%")) { pct++; t = t.slice(0, -1).trim(); }
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  t = t.replace(/^([+-]?)\$/, "$1").replace(/,/g, "");
  const n = decimalFromText(t);
  return Number.isNaN(n) ? NaN : (neg ? -n : n) / Math.pow(100, pct);
}

/** NUMBERVALUE, shared by the formula and the card: whitespace ignored, empty text is 0, each trailing `%` divides by 100. A blank separator takes its default (`.` decimal; `,` group unless the decimal is `,`). */
export function numberValue(text: string, decimalSep: string, groupSep: string): number | SolError {
  const bad = solError("#VALUE!", "NUMBERVALUE needs a number");
  const d = (decimalSep || ".")[0];
  const g: string | null = groupSep !== "" ? groupSep[0] : d === "," ? null : ",";
  if (g === d) return bad;
  let s = text.replace(/\s/g, "");
  if (s === "") return 0;
  let pct = 0;
  while (s.endsWith("%")) { pct++; s = s.slice(0, -1); }
  const di = s.indexOf(d);
  const intPart = di === -1 ? s : s.slice(0, di);
  const frac = di === -1 ? null : s.slice(di + 1);
  if (frac != null && ((g != null && frac.includes(g)) || frac.includes(d))) return bad;
  const n = decimalFromText((g != null ? intPart.split(g).join("") : intPart) + (frac != null ? `.${frac}` : ""));
  return Number.isNaN(n) ? bad : n / Math.pow(100, pct);
}

export function splitText(text: string, delimiter: string): string[] {
  return delimiter === "" ? [...text] : text.split(delimiter);
}

export function textAfterBefore(op: TextAfterBeforeOp, text: string, delimiter: string): string | null {
  if (delimiter === "") return null;
  const idx = text.indexOf(delimiter);
  if (idx === -1) return null;
  return op === "after" ? text.slice(idx + delimiter.length) : text.slice(0, idx);
}

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

export function regexApply(
  op: RegexOp, text: string, pattern: string, replacement = "", flags = "",
): number | string | string[] | null {
  if (!pattern) return null;
  const re = safeRegex(pattern, flags);
  if (!re) return null;
  // A fresh global RegExp for matchAll and replace leaves the caller's own `lastIndex` untouched.
  const global = () => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  switch (op) {
    case "test":           return re.test(text) ? 1 : 0;
    case "extract":        return text.match(re)?.[0] ?? "";
    case "extract_all":    return [...text.matchAll(global())].map((m) => m[0]);
    case "extract_groups": return regexGroups(text, pattern, flags);
    case "replace":        return text.replace(global(), replacement);
  }
}

export function regexGroups(text: string, pattern: string, flags = ""): string[] | null {
  if (!pattern) return null;
  const re = safeRegex(pattern, flags);
  if (!re) return null;
  const m = text.match(re);
  return m ? m.slice(1).map((g) => g ?? "") : [];
}

export function replaceNth(text: string, pattern: string, replacement: string, n: number, flags = ""): string | null {
  if (!pattern) return null;
  const re = safeRegex(pattern, flags);
  if (!re) return null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let i = 0;
  return text.replace(g, (match, ...rest) => {
    i++;
    if (i !== n) return match;
    // Replacing within the matched slice honors $1-style backreferences.
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

export function ordinalText(n: number): string {
  const i = Math.trunc(n), v = Math.abs(i) % 100;
  const suffix = ["th", "st", "nd", "rd"];
  return `${i}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
}

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

  // Read decimal digits one by one, at most 6, so float dust never reaches the words.
  const fracText = String(abs).includes(".") ? String(abs).split(".")[1].slice(0, 6) : "";
  if (fracText) words += ` point ${[...fracText].map((d) => SPELL_ONES[Number(d)]).join(" ")}`;

  return neg ? `negative ${words}` : words;
}

/** Excel's PROPER: a letter after any non-letter (digit, underscore, apostrophe) is capitalized, every other letter lowercased. */
export function properCase(t: string): string {
  let out = "";
  let afterLetter = false;
  for (const ch of t) {
    const letter = /\p{L}/u.test(ch);
    out += letter ? (afterLetter ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    afterLetter = letter;
  }
  return out;
}

export function reverseText(t: string): string {
  return [...t].reverse().join("");
}

export type SimilarityMethod = "ratio" | "levenshtein" | "damerau" | "jaro_winkler";

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

export function textSimilarity(a: string, b: string, method: SimilarityMethod = "ratio"): number {
  if (method === "levenshtein") return levenshtein(a, b);
  if (method === "jaro_winkler") return jaroWinkler(a, b);
  const maxLen = Math.max([...a].length, [...b].length);
  if (maxLen === 0) return 1;
  const dist = method === "damerau" ? damerauLevenshtein(a, b) : levenshtein(a, b);
  return 1 - dist / maxLen;
}

export function fuzzyBest(needle: string, candidates: readonly string[], method: SimilarityMethod = "ratio", threshold = 0):
  { index: number; text: string; score: number } | null {
  let best: { index: number; text: string; score: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const score = textSimilarity(needle, candidates[i], method === "levenshtein" ? "ratio" : method);
    if (score >= threshold && (best === null || score > best.score)) best = { index: i, text: candidates[i], score };
  }
  return best;
}

const TRANSLIT: Record<string, string> = {
  "ß": "ss", "æ": "ae", "Æ": "AE", "ø": "o", "Ø": "O", "œ": "oe", "Œ": "OE", "đ": "d", "Đ": "D",
  "ł": "l", "Ł": "L", "ð": "d", "Ð": "D", "þ": "th", "Þ": "TH", "ı": "i", "ŋ": "ng", "Ŋ": "NG",
};
export function unaccent(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ßæÆøØœŒđĐłŁðÐþÞıŋŊ]/g, (c) => TRANSLIT[c] ?? c);
}

export function slugify(t: string, sep = "-"): string {
  const body = unaccent(t).toLowerCase().replace(/[^a-z0-9]+/g, sep);
  if (!sep) return body;
  const esc = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`^(?:${esc})+|(?:${esc})+$`, "g"), "");
}

export type PadSide = "left" | "right" | "center";
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

export function truncateText(t: string, width: number, ellipsis = "…"): string {
  const chars = [...t];
  const w = Math.max(0, Math.floor(width));
  if (chars.length <= w) return t;
  const e = [...ellipsis];
  const keep = Math.max(0, w - e.length);
  return chars.slice(0, keep).join("") + (keep === 0 ? e.slice(0, w).join("") : ellipsis);
}

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

const TEMPLATE_TOKEN = /\{\{|\}\}|\{\s*([A-Za-z_][\w .-]*?|\d+)\s*(?::([^{}]*))?\}/g;

export function templatePlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TEMPLATE_TOKEN)) {
    const name = m[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

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
  number: (v: number, spec: string | undefined) => string;
  date?: (v: number, spec: string | undefined) => string;
}
export function templateFormat(value: unknown, spec: string | undefined, f: TemplateFormatters, isDate = false): string {
  if (value === null || value === undefined) return "";
  if (isSolError(value)) return value.code;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return isDate && f.date ? f.date(value, spec) : f.number(value, spec);
  if (Array.isArray(value)) return value.map((v) => templateFormat(v, spec, f, isDate)).join(", ");
  return String(value);
}

/** CHAR and UNICHAR, the CHAR / CODE card's char op: a truncated Unicode code point from 1 to 1114111, surrogates refused. */
export function charFromCode(code: number): string | SolError {
  const c = Math.trunc(code);
  if (!(c >= 1 && c <= 0x10ffff) || (c >= 0xd800 && c <= 0xdfff)) return solError("#VALUE!", "A character code is a code point from 1 to 1114111");
  return String.fromCodePoint(c);
}

/** CODE and UNICODE, the card's code op: the first character's Unicode code point. */
export function codeOfText(text: string): number | SolError {
  const c = text.codePointAt(0);
  return c === undefined ? solError("#VALUE!", "Empty text has no character code") : c;
}
