// [[C51]] formulaNaming
import { FORMULA_CONSTANTS } from "./excelFormula";
import { FRAME_SURFACE_NAMES, NODE_SURFACE_NAMES } from "./excelFunctions";
import { advertisedFunctionNames } from "./formulaExtensions";
import { signatureFor } from "./formulaSignatures";
import { fuzzyScore } from "./fuzzy";
import { emptySlotReading } from "./emptySlots";

// Not a module-level constant: packs register after load, and switching a pack off shrinks the advertised set.
let _fnSet = new Set<string>();
let _fnSetSource: string[] | null = null;
function fnSet(): Set<string> {
  const names = advertisedFunctionNames();
  if (names !== _fnSetSource) { _fnSet = new Set(names); _fnSetSource = names; }
  return _fnSet;
}
const CONST_SET = new Set(Object.keys(FORMULA_CONSTANTS));

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdStart = (c: string) => /[A-Za-z_λ]/.test(c);
const isIdChar = (c: string) => /[A-Za-z0-9_λ]/.test(c);

function identClass(word: string, isCall: boolean): string {
  if (isCall) {
    const up = word.toUpperCase();
    if (fnSet().has(up)) return "fx-fn";
    return FRAME_SURFACE_NAMES[up] || NODE_SURFACE_NAMES[up] ? "fx-frame" : "fx-unknown";
  }
  if (CONST_SET.has(word.toLowerCase())) return "fx-const";
  return "fx-var";
}

/** How an empty slot's reading shows ([[D96]] emptySlotShowsItsValue): `overlay` is a zero-width marker for the editor's
 *  mirror, so the typed text never moves; `inline` sits in the text, for a formula drawn read-only. */
export type GhostMode = "overlay" | "inline";

export function highlightFormula(src: string, ghosts: GhostMode = "inline"): string {
  let out = "";
  let i = 0;
  const span = (cls: string, text: string) => `<span class="${cls}">${esc(text)}</span>`;
  // Each open paren or brace: the call it belongs to, which argument is open, whether anything was typed in it, and where it starts in `out`.
  const stack: { name: string | null; arg: number; typed: boolean; at: number; from: number }[] = [];
  let pendingCall: string | null = null;
  const typed = () => { const top = stack[stack.length - 1]; if (top) top.typed = true; };
  const closeSlot = (closing: boolean) => {
    const top = stack[stack.length - 1];
    if (!top || !top.name || top.typed || (closing && top.arg === 0)) return;
    const shown = emptySlotReading(top.name, top.arg).shown;
    if (shown === null) return;
    // In the editor a reading sits in the slot's typed spaces when they fit it, else as a small raised label.
    const room = src.slice(top.from, i).length;
    const g = ghosts === "overlay"
      ? `<span class="fx-ghost${room >= shown.length ? "" : " fx-ghost--raised"}" data-ghost="${esc(shown)}"></span>`
      : `<span class="fx-ghost-inline">${esc(shown)}</span>`;
    out = out.slice(0, top.at) + g + out.slice(top.at);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { out += esc(c); i++; continue; }
    if (c !== "(") pendingCall = null;
    if (c !== "," && c !== ")" && c !== "(" && c !== "}") typed();
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
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      const end = j < src.length ? j + 1 : j;
      out += span("fx-str", src.slice(i, end)); i = end; continue;
    }
    if (c === "@" && isIdStart(src[i + 1] ?? "")) {
      let j = i + 2;
      while (j < src.length && isIdChar(src[j])) j++;
      out += span("fx-var", src.slice(i, j)); i = j; continue;
    }
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
      while (j < src.length && (isIdChar(src[j]) || (src[j] === "." && isIdChar(src[j + 1] ?? "")))) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && /\s/.test(src[k])) k++;
      out += span(identClass(word, src[k] === "("), word); i = j;
      pendingCall = src[k] === "(" ? word.toUpperCase() : null;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { out += span("fx-op", two); i += 2; continue; }
    if ("+-*/^%&=<>".includes(c)) { out += span("fx-op", c); i++; continue; }
    if (c === "(") {
      typed();
      out += span("fx-paren", c); i++;
      stack.push({ name: pendingCall, arg: 0, typed: false, at: out.length, from: i });
      pendingCall = null;
      continue;
    }
    if (c === ")") { closeSlot(true); stack.pop(); out += span("fx-paren", c); i++; continue; }
    if (c === ",") {
      closeSlot(false);
      out += span("fx-comma", c); i++;
      const top = stack[stack.length - 1];
      if (top) { top.arg++; top.typed = false; top.at = out.length; top.from = i; }
      continue;
    }
    if (c === "{") { out += span("fx-err", c); i++; stack.push({ name: null, arg: 0, typed: false, at: out.length, from: i }); continue; }
    if (c === "}") { stack.pop(); typed(); out += span("fx-err", c); i++; continue; }
    out += span("fx-err", c); i++;
  }
  return out;
}

export function tokenAtCaret(src: string, caret: number): { word: string; start: number } | null {
  let start = caret;
  while (start > 0 && isIdChar(src[start - 1])) start--;
  const word = src.slice(start, caret);
  if (!word || !isIdStart(word[0])) return null;
  return { word, start };
}

export type Suggestion = { name: string; kind: "fn" | "const" | "var"; hint?: string };

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
    if (name === q && s.kind !== "fn") continue;
    const fz = fuzzyScore(word, s.name);
    if (fz == null) continue;
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
      // Commas count only on the top frame, so this count already excludes an inner anonymous group's.
      return { name: frame.name, argIndex: frame.argIndex };
    }
  }
  return null;
}
