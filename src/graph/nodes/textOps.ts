import { solError, type SolError } from "../errorValue";
// The ONE implementation behind both the visual node and the formula registration.
// Separate from `text.ts` because that imports `excelFunctions` — the other
// direction would cycle and drag rete into the headless formula path.

export type TextAfterBeforeOp = "after" | "before";
export type UrlEncodeOp = "encode" | "decode";
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

/** ENCODEURL / DECODEURL over one string — a malformed escape (which makes
 *  `decodeURIComponent` throw) passes the text through unchanged. */
export function urlEncode(op: UrlEncodeOp, text: string): string {
  try {
    return op === "encode" ? encodeURIComponent(text) : decodeURIComponent(text);
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

/** Keep the strings matching the condition — case-insensitive (D12: comparisons
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
