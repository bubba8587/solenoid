// ─── Pure text ops — the ONE implementation behind both surfaces ─────────────
// Each function here is called by BOTH the visual node (`text.ts`) and the formula
// registration (`excelFunctions.ts`). Same pattern as `mathUtils.ts`, and for the
// same reason: the node set and the formula language drifted apart because every
// op got written twice, once per surface (docs/formula-node-parity.md, D19).
//
// It lives in its own module rather than in `text.ts` because `text.ts` already
// imports `excelFunctions` (for UPPER/LOWER/TRIM) — importing back the other way
// would cycle, and would drag rete into the headless formula path. Nothing here
// imports rete or touches a socket: pure string in, pure value out.

export type TextAfterBeforeOp = "after" | "before";
export type UrlEncodeOp = "encode" | "decode";
export type RegexOp = "test" | "extract" | "extract_all" | "replace";

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
    case "test":        return re.test(text) ? 1 : 0;
    case "extract":     return text.match(re)?.[0] ?? "";
    case "extract_all": return [...text.matchAll(global())].map((m) => m[0]);
    case "replace":     return text.replace(global(), replacement);
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
