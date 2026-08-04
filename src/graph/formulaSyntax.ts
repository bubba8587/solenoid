import { FORMULA_CONSTANTS } from "./excelFormula";
import { FRAME_SURFACE_NAMES } from "./excelFunctions";
import { advertisedFunctionNames } from "./formulaExtensions";
import { signatureFor } from "./formulaSignatures";
import { fuzzyScore } from "./fuzzy";

// A position-PRESERVING tokenizer: every character reaches the output, so the
// highlighted <pre> mirrors the <textarea> and a half-typed formula never bails.

// Can't be a module-level constant: packs register after load and the advertised
// set shrinks when a pack is switched off.
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

/** The CSS class for an identifier: in CALL position `fx-fn` / `fx-frame` (a real
 *  name whose type can't flow through formulas, so never a typo) / `fx-unknown`;
 *  bare, `fx-const` or `fx-var`. */
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
    // An unterminated string literal colors through to the end (mid-type).
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      const end = j < src.length ? j + 1 : j;
      out += span("fx-str", src.slice(i, end)); i = end; continue;
    }
    // @name — the this-row reference: ONE token, colored like a variable.
    if (c === "@" && isIdStart(src[i + 1] ?? "")) {
      let j = i + 2;
      while (j < src.length && isIdChar(src[j])) j++;
      out += span("fx-var", src.slice(i, j)); i = j; continue;
    }
    // Structured references (D24) are ONE token through the closing bracket,
    // colored like the variables they behave as; left open mid-type, color runs on.
    if (c === "[" || (c === "@" && src[i + 1] === "[")) {
      let j = i + (c === "@" ? 2 : 1);
      let depth = 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "[") depth++;
        else if (src[j] === "]") depth--;
        j++;
      }
      out += span("fx-var", src.slice(i, j)); i = j; continue;
    }
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
    // A fully-typed match is dropped unless it's a function, where accepting still
    // adds the `(`.
    if (name === q && s.kind !== "fn") continue;
    const fz = fuzzyScore(word, s.name);
    if (fz == null) continue;
    // Prefix first, then fuzzy score, then kind — so a node variable outranks the
    // long function list on a tie.
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

/** The innermost function call the caret sits inside, or null at the top level;
 *  string literals are skipped and an anonymous `(` group still nests, so the
 *  enclosing named call keeps counting ITS OWN commas. */
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
      // Only the TOP frame increments, so a named frame's count already excludes
      // commas belonging to an inner anonymous group.
      return { name: frame.name, argIndex: frame.argIndex };
    }
  }
  return null;
}
