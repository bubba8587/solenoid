import { FORMULA_CONSTANTS } from "./excelFormula";
import { FRAME_SURFACE_NAMES } from "./excelFunctions";
import { advertisedFunctionNames } from "./formulaExtensions";
import { signatureFor } from "./formulaSignatures";
import { fuzzyScore } from "./fuzzy";

// ─── Formula syntax highlighting + autocomplete helpers ───────────────────────
// A position-PRESERVING tokenizer (every character, incl. whitespace + unknowns,
// ends up in the output) so the highlighted <pre> mirrors the <textarea> exactly,
// character-for-character. It reuses the same lexical rules as excelFormula.ts's
// tokenizer but emits classed <span>s instead of tokens, and never bails on a
// half-typed formula. Pure (no React) so it's unit-testable.

// Recomputed when the advertised set changes (a pack toggling on or off, or a
// late registration) — it can't be a module-level constant any more, because pack
// functions register after load and the set shrinks when a pack is switched off.
let _fnSet = new Set<string>();
let _fnSetSource: string[] | null = null;
function fnSet(): Set<string> {
  const names = advertisedFunctionNames();
  if (names !== _fnSetSource) { _fnSet = new Set(names); _fnSetSource = names; }
  return _fnSet;
}
const CONST_SET = new Set(Object.keys(FORMULA_CONSTANTS)); // lowercase

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdChar = (c: string) => /[A-Za-z0-9_]/.test(c);

/**
 * The CSS class for an identifier given what follows it: a name in CALL position
 * (next non-space char is `(`) is a function — `fx-fn` if it's a real Formula.js
 * name, `fx-frame` if it's a FRAME VERB (a real name whose data type can't flow
 * through formulas — colored in the frame socket violet so it reads as "this is
 * frame territory", not as a typo), else `fx-unknown`. A bare name is a math
 * constant (`fx-const`) or a variable (`fx-var`).
 */
function identClass(word: string, isCall: boolean): string {
  if (isCall) {
    const up = word.toUpperCase();
    if (fnSet().has(up)) return "fx-fn";
    return FRAME_SURFACE_NAMES[up] ? "fx-frame" : "fx-unknown";
  }
  if (CONST_SET.has(word.toLowerCase())) return "fx-const";
  return "fx-var";
}

/** Highlight a formula → HTML (classed spans). Every input char is preserved. */
export function highlightFormula(src: string): string {
  let out = "";
  let i = 0;
  const span = (cls: string, text: string) => `<span class="${cls}">${esc(text)}</span>`;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { out += esc(c); i++; continue; }
    // number (with optional exponent)
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < src.length && isDigit(src[j])) j++;
      }
      out += span("fx-num", src.slice(i, j)); i = j; continue;
    }
    // string literal (color through the end even if unterminated, mid-type)
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      const end = j < src.length ? j + 1 : j;
      out += span("fx-str", src.slice(i, end)); i = end; continue;
    }
    // @name — the this-row reference: one token, colored like the variable it
    // behaves as (it reads row data).
    if (c === "@" && isIdStart(src[i + 1] ?? "")) {
      let j = i + 2;
      while (j < src.length && isIdChar(src[j])) j++;
      out += span("fx-var", src.slice(i, j)); i = j; continue;
    }
    // identifier — look past whitespace for a '(' to decide function vs name
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      out += span(identClass(word, src[k] === "("), word); i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { out += span("fx-op", two); i += 2; continue; }
    if ("+-*/^%&=<>".includes(c)) { out += span("fx-op", c); i++; continue; }
    if (c === "(" || c === ")") { out += span("fx-paren", c); i++; continue; }
    if (c === ",") { out += span("fx-comma", c); i++; continue; }
    out += span("fx-err", c); i++; // unknown char — flagged (span() escapes it)
  }
  return out;
}

/** The identifier word ending at the caret (for autocomplete), or null. A word
 *  must start with a letter/underscore (a number isn't an identifier). */
export function tokenAtCaret(src: string, caret: number): { word: string; start: number } | null {
  let start = caret;
  while (start > 0 && isIdChar(src[start - 1])) start--;
  const word = src.slice(start, caret);
  if (!word || !isIdStart(word[0])) return null;
  return { word, start };
}

export type Suggestion = { name: string; kind: "fn" | "const" | "var"; hint?: string };

/** Rank function names + constants + the node's own variables against the typed
 *  word (fuzzy, case-insensitive). Exact-prefix matches float to the top. */
export function suggestFor(word: string, extraNames: string[] = [], limit = 8): Suggestion[] {
  if (!word) return [];
  const pool: Suggestion[] = [
    ...extraNames.map((n) => ({ name: n, kind: "var" as const })),
    ...Object.keys(FORMULA_CONSTANTS).map((n) => ({ name: n, kind: "const" as const })),
    ...advertisedFunctionNames().map((n) => ({ name: n, kind: "fn" as const })),
  ];
  const q = word.toLowerCase();
  const scored: Array<{ s: Suggestion; score: number }> = [];
  for (const s of pool) {
    const name = s.name.toLowerCase();
    // A fully-typed match is dropped UNLESS it's a function — accepting a function
    // still adds its `(`, so `SUM` stays useful even once fully typed; `pi` doesn't.
    if (name === q && s.kind !== "fn") continue;
    const fz = fuzzyScore(word, s.name);
    if (fz == null) continue;
    // Prefix matches rank highest, then fuzzy score; a kind tie-break keeps a
    // node variable / constant ahead of the long function list when equal.
    const prefix = name.startsWith(q) ? 1000 : 0;
    const kindBonus = s.kind === "var" ? 3 : s.kind === "const" ? 2 : 0;
    scored.push({ s, score: prefix + fz + kindBonus });
  }
  scored.sort((a, b) => b.score - a.score || a.s.name.length - b.s.name.length);
  return scored.slice(0, limit).map((x) => {
    if (x.s.kind !== "fn") return x.s;
    const hint = signatureFor(x.s.name);
    return hint == null ? x.s : { ...x.s, hint };
  });
}

/** The innermost function call the caret sits inside — `{ name, argIndex }` — or
 *  null at the top level. Drives the param-hint bar: `INDEX(c, |` → INDEX, arg 1.
 *  String literals are skipped; an anonymous `(` group still nests (its enclosing
 *  named call keeps counting ITS OWN commas, not the group's). */
export function enclosingCall(src: string, caret: number): { name: string; argIndex: number } | null {
  const stack: Array<{ name: string | null; argIndex: number }> = [];
  let i = 0;
  const end = Math.min(caret, src.length);
  while (i < end) {
    const c = src[i];
    if (c === '"') { i++; while (i < end && src[i] !== '"') i++; i++; continue; }
    if (c === "(") {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      let name: string | null = null;
      if (j >= 0 && isIdChar(src[j])) {
        let s = j;
        while (s > 0 && isIdChar(src[s - 1])) s--;
        if (isIdStart(src[s])) name = src.slice(s, j + 1);
      }
      stack.push({ name, argIndex: 0 });
      i++; continue;
    }
    if (c === ")") { stack.pop(); i++; continue; }
    if (c === ",") { if (stack.length) stack[stack.length - 1].argIndex++; i++; continue; }
    i++;
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k];
    if (frame.name) {
      // Commas inside an anonymous ( ) group between the named call and the caret
      // belong to the group — the named frame's own count is already correct
      // because only the TOP frame increments.
      return { name: frame.name, argIndex: frame.argIndex };
    }
  }
  return null;
}
