// [[C17]] shareImpl
// Must not import `text.ts` (it imports `excelFunctions`; the cycle would drag the graph model into the formula path).
import { base64Encode, base64Decode } from "./hashOps";
import { solError, isSolError, type SolError } from "../errorValue";

export type TextAfterBeforeOp = "after" | "before";
export type UrlEncodeOp = "encode" | "decode" | "base64" | "unbase64";
export type RegexOp = "test" | "extract" | "extract_all" | "extract_groups" | "replace";

/** Where `delimiter` occurs, left to right and not overlapping; `caseless` is Excel's match_mode 1. */
function occurrences(text: string, delimiter: string, caseless: boolean): number[] {
  const hay = caseless ? text.toLowerCase() : text;
  const needle = caseless ? delimiter.toLowerCase() : delimiter;
  const at: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) at.push(i);
  return at;
}

export interface SplitOpts { rowDelimiter?: string; ignoreEmpty?: boolean; caseless?: boolean; pad?: unknown }

/**
 * TEXTSPLIT: the text split at `delimiter` into a list (one row). With a row delimiter it splits into rows first and
 * answers a table, short rows padded with `pad` (`#N/A` when left out, as Excel's). An empty delimiter splits into
 * single characters; `ignoreEmpty` drops the empty parts.
 */
/** A null `delimiter` leaves each row whole: TEXTSPLIT with a row delimiter only answers one column. */
export function splitText(text: string, delimiter: string | null, opts: SplitOpts = {}): string[] | unknown[][] {
  const caseless = opts.caseless ?? false;
  const cut = (t: string, d: string | null): string[] => {
    if (d === null) return [t];
    if (d === "") return [...t];
    const parts: string[] = [];
    let from = 0;
    for (const i of occurrences(t, d, caseless)) { parts.push(t.slice(from, i)); from = i + d.length; }
    parts.push(t.slice(from));
    return opts.ignoreEmpty ? parts.filter((p) => p !== "") : parts;
  };
  if (opts.rowDelimiter == null) return cut(text, delimiter);
  const rows = cut(text, opts.rowDelimiter).map((r) => cut(r, delimiter));
  const width = Math.max(0, ...rows.map((r) => r.length));
  const pad = opts.pad !== undefined ? opts.pad : solError("#N/A", "TEXTSPLIT: this row has fewer parts than the longest");
  return rows.map((r) => [...r, ...Array<unknown>(width - r.length).fill(pad)]);
}

export interface AfterBeforeOpts { instance?: number; caseless?: boolean; matchEnd?: boolean }

/**
 * TEXTAFTER / TEXTBEFORE at the `instance`-th delimiter, counted from the end when negative. `matchEnd` counts the end
 * of the text (the start, counting from the end) as one more delimiter. Not found, or an empty delimiter, is blank.
 */
export function textAfterBefore(op: TextAfterBeforeOp, text: string, delimiter: string, opts: AfterBeforeOpts = {}): string | null | SolError {
  const n = Math.trunc(opts.instance ?? 1);
  if (n === 0) return solError("#VALUE!", `TEXT${op.toUpperCase()}: instance_num can't be 0`);
  if (delimiter === "") return null;
  const at = occurrences(text, delimiter, opts.caseless ?? false).map((i) => ({ i, len: delimiter.length }));
  if (opts.matchEnd) { if (n > 0) at.push({ i: text.length, len: 0 }); else at.unshift({ i: 0, len: 0 }); }
  const hit = n > 0 ? at[n - 1] : at[at.length + n];
  if (!hit) return null;
  return op === "after" ? text.slice(hit.i + hit.len) : text.slice(0, hit.i);
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

const TEMPLATE_TOKEN = /\{\{|\}\}|\{\s*([A-Za-z_][\w .-]*?|\d+)\s*(?::([^{}]*))?\}/g;

export function templatePlaceholders(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TEMPLATE_TOKEN)) {
    const name = m[1];
    if (name !== undefined && !out.includes(name)) out.push(name);
  }
  return out;
}

export interface TemplateFormatters {
  number: (v: number, spec: string | undefined) => string;
}
export function templateFormat(value: unknown, spec: string | undefined, f: TemplateFormatters): string {
  if (value === null || value === undefined) return "";
  if (isSolError(value)) return value.code;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return f.number(value, spec);
  if (Array.isArray(value)) return value.map((v) => templateFormat(v, spec, f)).join(", ");
  return String(value);
}

