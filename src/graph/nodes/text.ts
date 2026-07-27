import { ClassicPreset } from "rete";
import { stringSocket } from "../sockets";
import {
  strIn, strOut, strListIn, strListOut, anyListIn, anyComboOut,
  strComboIn, strComboOut, numListIn, numListOut, logicalComboOut,
  broadcastCells, type CellResult, type BroadcastResult,
} from "./shared";
import { getRecalcGen } from "../process";
import { solError, type SolError } from "../errorValue";
import { resolveExcelFunction } from "../excelFunctions";
// The pure ops these nodes compute with, shared verbatim with the formula surface
// (see textOps.ts). Re-exported so the node barrel keeps its shape.
import { splitText, textAfterBefore, urlEncode, regexApply, safeRegex } from "./textOps";
import type { TextAfterBeforeOp, UrlEncodeOp, RegexOp } from "./textOps";
export { splitText, textAfterBefore, urlEncode, regexApply } from "./textOps";
export type { TextAfterBeforeOp, UrlEncodeOp, RegexOp } from "./textOps";

// ─── Element-wise text: the `strcombo` (scalar-or-list) sockets ───────────────
// Every text OPERAND is a `strcombo` and every element-wise text node broadcasts,
// so UPPER/LEFT/SUBSTITUTE/… take one string or a whole list of them — Excel's
// array-formula behavior (`=UPPER(A1:A10)` spills), matching what the number and
// date families already did. `broadcastCells` does the zip; a scalar in still
// yields a scalar out.
//
// Deliberately NOT broadcast, because they aren't element-wise operands:
//  - CONCAT / TEXTJOIN REDUCE a set of strings to one — Excel's CONCAT flattens an
//    array into a single string rather than spilling, so broadcasting would diverge.
//  - TEXTSPLIT and Text Filter already map 1-D → 1-D; broadcasting either would
//    need a rank-2 result the socket lattice has no 1-D→2-D edge for.
//  - A separator/pattern that selects a MODE (NUMBERVALUE's decimal/group
//    separators, Text Filter's pattern) stays scalar, like the date family's basis
//    and weekend_code.
//  - Text Input and Promo are literal SOURCES: exactly one value each.
//  - Regex stays on the wildcard ladder — its element type depends on the op, so it
//    can't take a family combo. It emits `anycombo` (the element-agnostic combo, added
//    2026-07-25) rather than the old `any`, which drew a SCALAR circle on a port that
//    REGEXEXTRACT-all and the list path can both spill a list from.

// Reads a text operand from either a wired input or the node's stringLiterals
// fallback. A `strcombo` input may deliver a LIST, so this yields `string |
// string[]` and the broadcaster zips whichever shape arrives.
function strVal(
  input: (string | string[])[] | undefined,
  node: { stringLiterals?: Record<string, string> },
  key: string,
  def = "",
): string | string[] {
  return input?.[0] ?? node.stringLiterals?.[key] ?? def;
}

/** The same read for an input that stayed a scalar `string` socket (a delimiter,
 *  a separator, a filter pattern) — the socket lattice can't deliver a list there,
 *  so the caller gets a plain string it can `.split()` / `.join()` with. */
function strScalar(
  input: string[] | undefined,
  node: { stringLiterals?: Record<string, string> },
  key: string,
  def = "",
): string {
  return input?.[0] ?? node.stringLiterals?.[key] ?? def;
}

// ─── Text Input ────────────────────────────────────────────────────────────

export class TextInputNode extends ClassicPreset.Node {
  label: string;
  value: string;
  cachedText: string | null = null;
  width = 180; height = 104;

  constructor(init?: { label?: string; value?: string }) {
    super("TextInput");
    this.label = init?.label ?? "Text Input";
    this.value = init?.value ?? "";
    this.addOutput("value", strOut("Text"));
  }

  data() {
    this.cachedText = this.value;
    return { value: this.value };
  }
}

// ─── Promo (easter egg) ────────────────────────────────────────────────────────
// A no-input source that emits a random Solenoid tagline. Lives in the "Other"
// add-menu category (and exists mostly to populate it). Volatile: re-rolls on
// recalc (F9 / requestRecalc), like the RAND family.
const PROMO_LINES = [
  "Solenoid: wire it, don't write it. ⚡",
  "Spreadsheets, but the formulas have shapes now.",
  "No more =SUM(A1:A8). Just plug it in.",
  "Every cell wishes it were a node.",
  "Built with Excel envy and React. 🔌",
  "If you can chart it, you can wire it.",
  "Ctrl+Z is a love language.",
];

export class PromoNode extends ClassicPreset.Node {
  label: string;
  cachedText: string | null = null;
  private lastRollGen = -1;
  private idx = Math.floor(Math.random() * PROMO_LINES.length);
  width = 220; height = 96;

  constructor(init?: { label?: string }) {
    super("Promo");
    this.label = init?.label ?? "✨ Promo";
    this.addOutput("value", strOut("Text"));
  }

  data() {
    const gen = getRecalcGen();
    if (this.lastRollGen !== gen) {
      this.idx = Math.floor(Math.random() * PROMO_LINES.length);
      this.lastRollGen = gen;
    }
    this.cachedText = PROMO_LINES[this.idx];
    return { value: this.cachedText };
  }
}

// ─── Text Transform (UPPER / LOWER / TRIM / PROPER / CLEAN) ──────────────────

export type TextTransformOp = "upper" | "lower" | "trim" | "proper" | "clean";

export const TEXT_TRANSFORM_OP_META = {
  upper:  { label: "UPPER",  description: "Converts all characters to uppercase. Excel: UPPER." },
  lower:  { label: "LOWER",  description: "Converts all characters to lowercase. Excel: LOWER." },
  trim:   { label: "TRIM",   description: "Removes leading/trailing spaces and collapse internal spaces. Excel: TRIM." },
  proper: { label: "PROPER", description: "Capitalize the first letter of each word. Excel: PROPER." },
  clean:  { label: "CLEAN",  description: "Removes non-printable control characters (ASCII 0–31). Excel: CLEAN." },
} satisfies Record<TextTransformOp, { label: string; description: string }>;

// UPPER/LOWER/TRIM are verified byte-identical to Formula.js, so those three route
// through the shared seam. PROPER stays hand-rolled: FX's PROPER only capitalizes
// after certain separators, not Excel's "after any non-letter" rule (verified
// divergence, e.g. "a-b_c.d" → ours "A-B_c.D", FX "A-b_c.d"). CLEAN has no Formula.js
// equivalent.
function applyTextTransform(op: TextTransformOp, text: string): string {
  switch (op) {
    case "upper": return resolveExcelFunction("UPPER")!(text) as string;
    case "lower": return resolveExcelFunction("LOWER")!(text) as string;
    case "trim":  return resolveExcelFunction("TRIM")!(text) as string;
    case "proper": return text.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
    case "clean":  return text.replace(/[\x00-\x1F\x7F]/g, "");
  }
}

export class TextTransformNode extends ClassicPreset.Node {
  label: string;
  op: TextTransformOp;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 170;

  constructor(init?: { label?: string; op?: TextTransformOp }) {
    super("TextTransform");
    this.label = init?.label ?? "UPPER";
    this.op    = init?.op    ?? "upper";
    this.addInput("text", strComboIn("Text"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: { text?: (string | string[])[] }): { result: CellResult<string> } {
    const result = broadcastCells(
      (t: string) => applyTextTransform(this.op, t),
      strVal(inputs.text, this, "text"),
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── LEN ──────────────────────────────────────────────────────────────────────

export class TextLenNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 135;

  constructor(init?: { label?: string }) {
    super("TextLen");
    this.label = init?.label ?? "LEN";
    this.addInput("text", strComboIn("Text"));
    this.addOutput("result", numListOut("Length"));
  }

  data(inputs: { text?: (string | string[])[] }): { result: BroadcastResult } {
    const result = broadcastCells(
      (t: string) => resolveExcelFunction("LEN")!(t) as number,
      strVal(inputs.text, this, "text"),
    );
    this.cachedResult = result;
    return { result };
  }
}

// ─── CONCAT ───────────────────────────────────────────────────────────────────

export class ConcatNode extends ClassicPreset.Node {
  label: string;
  cachedText: string | null = null;
  // Sparse — each row's literal is only set if the user typed into it.
  stringLiterals: Record<string, string> = {};
  // Extensible inputs: rows added/removed by the user (see ExtensibleInputs),
  // exactly like List Input but string-typed. `nextInputId` keeps keys unique.
  nextInputId = 0;
  readonly valueSocket = stringSocket;
  width = 180; height = 225;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("Concat");
    this.label = init?.label ?? "CONCAT";
    // Rebuild the exact input keys on load/paste (so saved literals + cables
    // still line up); otherwise start with four blank rows.
    if (init?.valueKeys?.length) {
      for (const k of init.valueKeys) this.addInputWithKey(k);
    } else {
      for (let i = 0; i < 4; i++) this.addValueInput();
    }
    this.addOutput("result", strOut("Result"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, new ClassicPreset.Input(this.valueSocket));
    const n = parseInt(key.replace(/^v/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  addValueInput(): string {
    const key = `v${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
    delete this.stringLiterals[key];
  }

  data(inputs: Record<string, string[] | undefined>): { result: string } {
    const values = Object.keys(this.inputs).map((key) => inputs[key]?.[0] ?? this.stringLiterals[key] ?? "");
    const result = resolveExcelFunction("CONCAT")!(...values) as string;
    this.cachedText = result;
    return { result };
  }
}

// ─── LEFT / RIGHT / MID ───────────────────────────────────────────────────────

export type TextSliceOp = "left" | "right" | "mid";

export const TEXT_SLICE_OP_META = {
  left:  { label: "LEFT",  description: "First N characters. Excel: LEFT." },
  right: { label: "RIGHT", description: "Last N characters. Excel: RIGHT." },
  mid:   { label: "MID",   description: "Substring starting at position Start with length Len (1-based). Excel: MID." },
} satisfies Record<TextSliceOp, { label: string; description: string }>;

export class TextSliceNode extends ClassicPreset.Node {
  label: string;
  op: TextSliceOp;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { n: 1, start: 1, len: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: TextSliceOp }) {
    super("TextSlice");
    this.label = init?.label ?? "LEFT";
    this.op    = init?.op    ?? "left";
    this.addInput("text",  strComboIn("Text"));
    this.addInput("n",     numListIn("N (LEFT/RIGHT)"));
    this.addInput("start", numListIn("Start (MID)"));
    this.addInput("len",   numListIn("Len (MID)"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: {
    text?: (string | string[])[];
    n?: (number | number[])[];
    start?: (number | number[])[];
    len?: (number | number[])[];
  }): { result: CellResult<string> } {
    const text = strVal(inputs.text, this, "text");
    // Only the operands the CHOSEN op reads take part in the zip — otherwise a list
    // left in the unused MID boxes would spill a LEFT result into a list.
    const result = this.op === "mid"
      ? broadcastCells((t: string, s: number, l: number) => {
          const len = Math.max(0, Math.floor(l));
          // Formula.js MID errors on num_chars = 0 (a real Excel input that returns "") —
          // guard that one edge, delegate the rest (verified byte-identical otherwise).
          return len === 0 ? "" : resolveExcelFunction("MID")!(t, Math.max(1, Math.floor(s)), len) as string;
        },
        text,
        inputs.start?.[0] ?? this.literals.start ?? 1,
        inputs.len?.[0]   ?? this.literals.len   ?? 1)
      : broadcastCells((t: string, count: number) => {
          const fn = this.op === "left" ? "LEFT" : "RIGHT";
          return resolveExcelFunction(fn)!(t, Math.max(0, Math.floor(count))) as string;
        },
        text,
        inputs.n?.[0] ?? this.literals.n ?? 1);
    this.cachedText = result;
    return { result };
  }
}

// ─── FIND / SEARCH ────────────────────────────────────────────────────────────

export type TextFindOp = "find" | "search";

export const TEXT_FIND_OP_META = {
  find:   { label: "FIND",   description: "1-based position of find_text in within_text (case-sensitive); #VALUE! if not found. Excel: FIND." },
  search: { label: "SEARCH", description: "1-based position of find_text in within_text (case-insensitive); #VALUE! if not found. Excel: SEARCH." },
} satisfies Record<TextFindOp, { label: string; description: string }>;

export class TextFindNode extends ClassicPreset.Node {
  label: string;
  op: TextFindOp;
  cachedResult: BroadcastResult = null;
  stringLiterals: Record<string, string> = { needle: "", haystack: "" };
  literals: Record<string, number> = { start: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: TextFindOp }) {
    super("TextFind");
    this.label = init?.label ?? "FIND";
    this.op    = init?.op    ?? "find";
    this.addInput("needle",   strComboIn("Find text"));
    this.addInput("haystack", strComboIn("Within text"));
    this.addInput("start",    numListIn("Start (optional)"));
    this.addOutput("result", numListOut("Position"));
  }

  data(inputs: {
    needle?: (string | string[])[];
    haystack?: (string | string[])[];
    start?: (number | number[])[];
  }): { result: BroadcastResult } {
    const result = broadcastCells((needle: string, haystack: string, s: number) => {
      const raw = resolveExcelFunction(this.op === "find" ? "FIND" : "SEARCH")!(
        needle, haystack, Math.max(1, Math.floor(s)));
      // Excel FIND/SEARCH return #VALUE! when the substring is absent — Formula.js
      // signals the same case as an Error, so map it to our tagged SolError (and the
      // formula path's FIND via Formula.js → #VALUE! too), keeping node == formula == Excel.
      // Per CELL, so one unmatched string in a list doesn't fail the whole result.
      return raw instanceof Error
        ? solError("#VALUE!", "Find text not found within the text")
        : raw as number;
    },
      strVal(inputs.needle,   this, "needle"),
      strVal(inputs.haystack, this, "haystack"),
      inputs.start?.[0] ?? this.literals.start ?? 1);
    this.cachedResult = result;
    return { result };
  }
}

// ─── SUBSTITUTE ───────────────────────────────────────────────────────────────

export class SubstituteNode extends ClassicPreset.Node {
  label: string;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "", old_text: "", new_text: "" };
  width = 180; height = 225;

  constructor(init?: { label?: string }) {
    super("Substitute");
    this.label = init?.label ?? "SUBSTITUTE";
    this.addInput("text",     strComboIn("Text"));
    this.addInput("old_text", strComboIn("Old text"));
    this.addInput("new_text", strComboIn("New text"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: {
    text?: (string | string[])[];
    old_text?: (string | string[])[];
    new_text?: (string | string[])[];
  }): { result: CellResult<string> } {
    const result = broadcastCells(
      (text: string, oldText: string, newText: string) =>
        resolveExcelFunction("SUBSTITUTE")!(text, oldText, newText) as string,
      strVal(inputs.text,     this, "text"),
      strVal(inputs.old_text, this, "old_text"),
      strVal(inputs.new_text, this, "new_text"),
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── REPLACE ─────────────────────────────────────────────────────────────────

export class TextReplaceNode extends ClassicPreset.Node {
  label: string;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "", new_text: "" };
  literals: Record<string, number> = { start: 1, num_chars: 1 };
  width = 180; height = 250;

  constructor(init?: { label?: string }) {
    super("TextReplace");
    this.label = init?.label ?? "REPLACE";
    this.addInput("text",      strComboIn("Text"));
    this.addInput("start",     numListIn("Start"));
    this.addInput("num_chars", numListIn("Num chars"));
    this.addInput("new_text",  strComboIn("New text"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: {
    text?: (string | string[])[];
    start?: (number | number[])[];
    num_chars?: (number | number[])[];
    new_text?: (string | string[])[];
  }): { result: CellResult<string> } {
    const result = broadcastCells(
      (text: string, s: number, n: number, newText: string) =>
        resolveExcelFunction("REPLACE")!(
          text, Math.max(1, Math.floor(s)), Math.max(0, Math.floor(n)), newText) as string,
      strVal(inputs.text, this, "text"),
      inputs.start?.[0]     ?? this.literals.start     ?? 1,
      inputs.num_chars?.[0] ?? this.literals.num_chars ?? 1,
      strVal(inputs.new_text, this, "new_text"),
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── Number formatting pattern (shared by Cast-to-text) ───────────────────────

/**
 * TEXT-style simplified number formatting: "" / "general" → default string,
 * "0" / "0.00" → fixed decimals, "0%" / "0.00%" → percentage. Shared by the
 * TEXT node and Cast-to-text. (The decimal branch's regex was once
 * `/^0(\\.0+)?$/` — a double-escape that matched a literal backslash, so
 * "0.00" silently fell through to the default conversion.)
 */
export function formatNumberPattern(v: number, format: string): string {
  if (format === "" || format === "general") return String(v);
  if (/^0(\.0+)?$/.test(format)) {
    const decimals = (format.split(".")[1] ?? "").length;
    return v.toFixed(decimals);
  }
  if (format.endsWith("%")) {
    const inner = format.slice(0, -1);
    const decimals = (inner.split(".")[1] ?? "").length;
    return (v * 100).toFixed(decimals) + "%";
  }
  return String(v);
}

// ─── REPT ─────────────────────────────────────────────────────────────────────

export class ReptNode extends ClassicPreset.Node {
  label: string;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { times: 1 };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("Rept");
    this.label = init?.label ?? "REPT";
    this.addInput("text",  strComboIn("Text"));
    this.addInput("times", numListIn("Times"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: { text?: (string | string[])[]; times?: (number | number[])[] }): { result: CellResult<string> } {
    const result = broadcastCells(
      (text: string, times: number) =>
        resolveExcelFunction("REPT")!(text, Math.max(0, Math.floor(times))) as string,
      strVal(inputs.text, this, "text"),
      inputs.times?.[0] ?? this.literals.times ?? 1,
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── CHAR / CODE ─────────────────────────────────────────────────────────────

export type CharCodeOp = "char" | "code";

export class CharCodeNode extends ClassicPreset.Node {
  label: string;
  op: CharCodeOp;
  cachedResult: CellResult<string | number> = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { code: 65 };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: CharCodeOp }) {
    super("CharCode");
    this.op = init?.op ?? "char";
    this.label = init?.label ?? (this.op === "char" ? "CHAR" : "CODE");
    if (this.op === "char") {
      this.addInput("code", numListIn("Code point"));
      this.addOutput("result", strComboOut("Character"));
    } else {
      this.addInput("text", strComboIn("Text"));
      this.addOutput("result", numListOut("Code point"));
    }
  }

  data(inputs: { code?: (number | number[])[]; text?: (string | string[])[] }): { result: CellResult<string | number> } {
    // An out-of-range code point (or an empty string) is a per-cell blank, so one
    // bad element in a list doesn't blank the rest.
    const result: CellResult<string | number> = this.op === "char"
      ? broadcastCells((c: number) => {
          try { return String.fromCodePoint(Math.floor(c)); } catch { return null; }
        }, inputs.code?.[0] ?? this.literals.code ?? 65)
      : broadcastCells((t: string) => (t.length > 0 ? (t.codePointAt(0) ?? null) : null),
          strVal(inputs.text, this, "text"));
    this.cachedResult = result;
    return { result };
  }
}

// ─── TEXTJOIN ─────────────────────────────────────────────────────────────────

export type TextJoinIgnoreEmpty = "include" | "ignore";

export const TEXTJOIN_IGNORE_EMPTY_META: Record<TextJoinIgnoreEmpty, string> = {
  include: "Include empty strings (0)",
  ignore:  "Ignore empty strings (1)",
};

export class TextJoinNode extends ClassicPreset.Node {
  label: string;
  ignoreEmpty: TextJoinIgnoreEmpty;
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { delimiter: "" };
  width = 180; height = 200;

  constructor(init?: { label?: string; ignoreEmpty?: TextJoinIgnoreEmpty }) {
    super("TextJoin");
    this.label       = init?.label       ?? "TEXTJOIN";
    this.ignoreEmpty = init?.ignoreEmpty ?? "include";
    this.addInput("strings",   strListIn("Strings"));
    this.addInput("delimiter", strIn("Delimiter"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { strings?: string[][]; delimiter?: string[] }): { result: string } {
    const strings: string[] = inputs.strings?.[0] ?? [];
    const delimiter = strScalar(inputs.delimiter, this, "delimiter");
    const parts     = this.ignoreEmpty === "ignore" ? strings.filter(s => s !== "") : strings;
    const result    = parts.join(delimiter);
    this.cachedText = result;
    return { result };
  }
}

// ─── TEXTSPLIT ────────────────────────────────────────────────────────────────

export class TextSplitNode extends ClassicPreset.Node {
  label: string;
  cachedResult: string[] | null = null;
  stringLiterals: Record<string, string> = { text: "", delimiter: "" };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("TextSplit");
    this.label = init?.label ?? "TEXTSPLIT";
    this.addInput("text",      strIn("Text"));
    this.addInput("delimiter", strIn("Delimiter"));
    this.addOutput("result", strListOut("Parts"));
  }

  data(inputs: { text?: string[]; delimiter?: string[] }): { result: string[] } {
    const text      = strScalar(inputs.text,      this, "text");
    const delimiter = strScalar(inputs.delimiter, this, "delimiter");
    const result    = splitText(text, delimiter);
    this.cachedResult = result;
    return { result };
  }
}

// ─── TEXTAFTER / TEXTBEFORE ───────────────────────────────────────────────────

export const TEXT_AFTER_BEFORE_OP_META = {
  after:  { label: "TEXTAFTER",  description: "Text after the first occurrence of delimiter; null if not found. Excel: TEXTAFTER." },
  before: { label: "TEXTBEFORE", description: "Text before the first occurrence of delimiter; null if not found. Excel: TEXTBEFORE." },
} satisfies Record<TextAfterBeforeOp, { label: string; description: string }>;

export class TextAfterBeforeNode extends ClassicPreset.Node {
  label: string;
  op: TextAfterBeforeOp;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "", delimiter: "" };
  width = 180; height = 205;

  constructor(init?: { label?: string; op?: TextAfterBeforeOp }) {
    super("TextAfterBefore");
    this.op    = init?.op    ?? "after";
    this.label = init?.label ?? TEXT_AFTER_BEFORE_OP_META[this.op].label;
    this.addInput("text",      strComboIn("Text"));
    this.addInput("delimiter", strComboIn("Delimiter"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: {
    text?: (string | string[])[];
    delimiter?: (string | string[])[];
  }): { result: CellResult<string> } {
    // A blank delimiter, or one an element doesn't contain, is a per-cell blank.
    const result = broadcastCells((text: string, delimiter: string) => textAfterBefore(this.op, text, delimiter),
      strVal(inputs.text,      this, "text"),
      strVal(inputs.delimiter, this, "delimiter"));
    this.cachedText = result;
    return { result };
  }
}

// ─── EXACT ────────────────────────────────────────────────────────────────────

export class ExactNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CellResult<boolean> = null;
  stringLiterals: Record<string, string> = { a: "", b: "" };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("Exact");
    this.label = init?.label ?? "EXACT";
    this.addInput("a", strComboIn("Text 1"));
    this.addInput("b", strComboIn("Text 2"));
    // A first-class logical (TRUE/FALSE) like Excel EXACT — not 1/0. Coerces to 1/0
    // anywhere a number is wanted (the logical↔number socket bridge, which mirrors
    // combo→scalar, so this combo still reaches a plain `number` input).
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: { a?: (string | string[])[]; b?: (string | string[])[] }): { result: CellResult<boolean> } {
    const result = broadcastCells(
      (a: string, b: string) => a === b,
      strVal(inputs.a, this, "a"),
      strVal(inputs.b, this, "b"),
    );
    this.cachedResult = result;
    return { result };
  }
}

// ─── TEXTFILTER ──────────────────────────────────────────────────────────────

export type TextFilterOp = "contains" | "not_contains" | "starts_with" | "ends_with";

export const TEXT_FILTER_OP_META = {
  contains:     { label: "Contains",     description: "Keep strings that contain the pattern; case-sensitive" },
  not_contains: { label: "Not contains", description: "Keep strings that do NOT contain the pattern" },
  starts_with:  { label: "Starts with",  description: "Keep strings that begin with the pattern" },
  ends_with:    { label: "Ends with",    description: "Keep strings that end with the pattern" },
} satisfies Record<TextFilterOp, { label: string; description: string }>;

export class TextFilterNode extends ClassicPreset.Node {
  label: string;
  op: TextFilterOp;
  cachedResult: string[] | null = null;
  stringLiterals: Record<string, string> = { pattern: "" };
  width = 180; height = 195;

  constructor(init?: { label?: string; op?: TextFilterOp }) {
    super("TextFilter");
    this.op    = init?.op    ?? "contains";
    this.label = init?.label ?? "Text Filter";
    this.addInput("strings", strListIn("Strings"));
    this.addInput("pattern", strIn("Pattern"));
    this.addOutput("result", strListOut("Filtered"));
  }

  data(inputs: { strings?: string[][]; pattern?: string[] }): { result: string[] } {
    const strings = inputs.strings?.[0] ?? [];
    const pattern = inputs.pattern?.[0] ?? this.stringLiterals.pattern ?? "";
    let result: string[];
    switch (this.op) {
      case "contains":     result = strings.filter(s => s.includes(pattern));    break;
      case "not_contains": result = strings.filter(s => !s.includes(pattern));   break;
      case "starts_with":  result = strings.filter(s => s.startsWith(pattern));  break;
      case "ends_with":    result = strings.filter(s => s.endsWith(pattern));     break;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── NUMBERVALUE ─────────────────────────────────────────────────────────────

export class NumberValueNode extends ClassicPreset.Node {
  label: string;
  cachedResult: BroadcastResult = null;
  // The separators ship EMPTY so the field shows a muted "."/"," placeholder (the
  // default); data() treats empty/unset as the default via `||`.
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 195;

  constructor(init?: { label?: string }) {
    super("NumberValue");
    this.label = init?.label ?? "NUMBERVALUE";
    this.addInput("text",        strComboIn("Text"));
    // The separators pick a parsing CONVENTION, not a per-element operand, so they
    // stay scalar (like the date family's basis / weekend_code).
    this.addInput("decimal_sep", strIn("Decimal sep (default \".\")"));
    this.addInput("group_sep",   strIn("Group sep (default \",\")"));
    this.addOutput("result", numListOut("Number"));
  }

  data(inputs: {
    text?: (string | string[])[];
    decimal_sep?: string[];
    group_sep?: string[];
  }): { result: BroadcastResult } {
    // `||` (not `??`): an empty/unset separator field means "use the default", so a
    // blank box (placeholder showing) still parses with "."/",".
    const decSep = inputs.decimal_sep?.[0] || this.stringLiterals.decimal_sep || ".";
    const grpSep = inputs.group_sep?.[0]   || this.stringLiterals.group_sep   || ",";
    const result = broadcastCells((raw: string) => {
      const text = raw.trim();
      // Empty input is blank (null); a non-empty string that won't parse is a
      // genuine #VALUE! error — per cell, so one bad string in a list errors alone.
      if (!text) return null;
      // NUMBERVALUE semantics: strip group separators, normalize the decimal
      // separator, ignore ALL whitespace (incl. embedded — "1 234" → 1234), then
      // peel trailing `%` signs (each divides by 100 — "12%%" → 0.0012). The final
      // parse is STRICT full-string via Number(), not parseFloat's greedy prefix, so
      // "12x" is #VALUE! rather than 12.
      let s = text
        .split(grpSep).join("")
        .split(decSep).join(".")
        .replace(/\s+/g, "");
      let pct = 0;
      while (s.endsWith("%")) { pct++; s = s.slice(0, -1); }
      // Number("") is 0 — guard it so an all-% / emptied string is #VALUE!, not 0.
      const n = s === "" ? NaN : Number(s);
      if (!Number.isFinite(n)) return solError("#VALUE!", `Cannot parse "${text}" as a number`);
      return pct > 0 ? n / Math.pow(100, pct) : n;
    }, strVal(inputs.text, this, "text"));
    this.cachedResult = result;
    return { result };
  }
}

// TextMap ("UPPER (list)") was retired with the combo pass: Text Transform now
// takes a `strcombo`, so wiring a list into UPPER does exactly what it did. An old
// save referencing it loads as a Placeholder (wiring + data kept).

// ─── ENCODEURL / DECODEURL ────────────────────────────────────────────────────

export class UrlEncodeNode extends ClassicPreset.Node {
  label: string;
  op: UrlEncodeOp;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: UrlEncodeOp }) {
    super("UrlEncode");
    this.op    = init?.op ?? "encode";
    this.label = init?.label ?? (this.op === "encode" ? "ENCODEURL" : "DECODEURL");
    this.addInput("text", strComboIn("Text"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: { text?: (string | string[])[] }): { result: CellResult<string> } {
    const result = broadcastCells((text: string) => urlEncode(this.op, text), strVal(inputs.text, this, "text"));
    this.cachedText = result;
    return { result };
  }
}

// ─── ROMAN / ARABIC ───────────────────────────────────────────────────────────

export type RomanArabicOp = "roman" | "arabic";

export class RomanArabicNode extends ClassicPreset.Node {
  label: string;
  op: RomanArabicOp;
  cachedResult: CellResult<string | number> = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { number: 1 };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: RomanArabicOp }) {
    super("RomanArabic");
    this.op    = init?.op ?? "roman";
    this.label = init?.label ?? (this.op === "roman" ? "ROMAN" : "ARABIC");
    if (this.op === "roman") {
      this.addInput("number", numListIn("Number (1–3999)"));
      this.addOutput("result", strComboOut("Roman numeral"));
    } else {
      this.addInput("text", strComboIn("Roman numeral"));
      this.addOutput("result", numListOut("Number"));
    }
  }

  data(inputs: { number?: (number | number[])[]; text?: (string | string[])[] }): { result: CellResult<string | number> } {
    const result: CellResult<string | number> = this.op === "roman"
      ? broadcastCells((raw: number) => {
          const n = Math.floor(raw);
          // ROMAN only spans 1–3999; anything else is out of range (#VALUE!).
          if (n < 1 || n > 3999) return solError("#VALUE!", "ROMAN is defined only for 1–3999");
          const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
          const syms = ["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
          let out = ""; let rem = n;
          for (let i = 0; i < vals.length; i++) {
            while (rem >= vals[i]) { out += syms[i]; rem -= vals[i]; }
          }
          return out;
        }, inputs.number?.[0] ?? this.literals.number ?? 1)
      : broadcastCells((raw: string) => {
          const text = raw.toUpperCase().trim();
          // Empty input is blank (null). A non-empty string with a non-Roman
          // character is an invalid numeral (#VALUE!) — per cell.
          if (!text) return null;
          const map: Record<string, number> = { M:1000, D:500, C:100, L:50, X:10, V:5, I:1 };
          let out = 0; let prev = 0;
          for (let i = text.length - 1; i >= 0; i--) {
            const v = map[text[i]];
            if (v === undefined) return solError("#VALUE!", `"${text}" is not a valid Roman numeral`);
            if (v < prev) out -= v; else { out += v; prev = v; }
          }
          return out;
        }, strVal(inputs.text, this, "text"));
    this.cachedResult = result;
    return { result };
  }
}

// ─── FIXED ────────────────────────────────────────────────────────────────────

export type FixedNoCommas = "commas" | "no_commas";

export const FIXED_NO_COMMAS_META: Record<FixedNoCommas, string> = {
  commas:    "With thousand separators (0)",
  no_commas: "No thousand separators (1)",
};

export class FixedNode extends ClassicPreset.Node {
  label: string;
  noCommas: FixedNoCommas;
  cachedText: CellResult<string> = null;
  literals: Record<string, number> = { number: 0 }; // decimals ships unset → muted "2" placeholder (data() defaults)
  width = 180; height = 175;

  constructor(init?: { label?: string; noCommas?: FixedNoCommas }) {
    super("Fixed");
    this.label    = init?.label    ?? "FIXED";
    this.noCommas = init?.noCommas ?? "commas";
    this.addInput("number",   numListIn("Number"));
    this.addInput("decimals", numListIn("Decimals (default 2)"));
    this.addOutput("result", strComboOut("Text"));
  }

  data(inputs: { number?: (number | number[])[]; decimals?: (number | number[])[] }): { result: CellResult<string> } {
    const result = broadcastCells(
      (n: number, d: number) => resolveExcelFunction("FIXED")!(
        n, Math.max(0, Math.floor(d)), this.noCommas === "no_commas") as string,
      inputs.number?.[0]   ?? this.literals.number   ?? 0,
      inputs.decimals?.[0] ?? this.literals.decimals ?? 2,
    );
    this.cachedText = result;
    return { result };
  }
}


// ─── REGEX (REGEXTEST / REGEXEXTRACT / REGEXREPLACE) ─────────────────────────

export const REGEX_OP_META: Record<RegexOp, { label: string; description: string }> = {
  test:        { label: "REGEXTEST",         description: "Returns 1 if text matches the pattern, else 0. Wired list input broadcasts element-wise. Excel 365: REGEXTEST." },
  extract:     { label: "REGEXEXTRACT",      description: "Returns the first match found in text, or empty string if none. Wired list input returns a list of first matches. Excel 365: REGEXEXTRACT." },
  extract_all: { label: "REGEXEXTRACT (all)", description: "Returns all matches found in a single string as a list. Excel 365: REGEXEXTRACT with return_all=TRUE." },
  replace:     { label: "REGEXREPLACE",      description: "Replaces all regex matches with the replacement string. Wired list input broadcasts element-wise. Excel 365: REGEXREPLACE." },
};


export class RegexNode extends ClassicPreset.Node {
  label: string;
  op: RegexOp;
  cachedResult: number | number[] | string | string[] | null = null;
  stringLiterals: Record<string, string> = { pattern: "", replacement: "", flags: "" };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: RegexOp }) {
    super("Regex");
    this.op    = init?.op    ?? "test";
    this.label = init?.label ?? REGEX_OP_META[this.op].label;
    this.addInput("text",        anyListIn("Text"));
    this.addInput("pattern",     strIn("Pattern"));
    this.addInput("replacement", strIn("Replace with"));
    this.addOutput("result", anyComboOut("Result"));
  }

  data(inputs: {
    text?: unknown[];
    pattern?: string[];
    replacement?: string[];
  }): { result: number | number[] | string | string[] | null } {
    const pattern     = inputs.pattern?.[0]     ?? this.stringLiterals.pattern     ?? "";
    const replacement = inputs.replacement?.[0] ?? this.stringLiterals.replacement ?? "";
    const flags       = this.stringLiterals.flags ?? "";

    if (!pattern || !safeRegex(pattern, flags)) { this.cachedResult = null; return { result: null }; }

    const rawText = inputs.text?.[0];
    const isList  = Array.isArray(rawText);
    const texts   = isList ? (rawText as unknown[]).map(String) : [String(rawText ?? "")];

    const applyOne = (t: string) =>
      regexApply(this.op, t, pattern, replacement, flags) as number | string | string[];

    let result: number | number[] | string | string[] | null;
    if (this.op === "extract_all") {
      result = applyOne(texts[0]) as string[];
    } else if (isList) {
      result = texts.map((t) => applyOne(t)) as number[] | string[];
    } else {
      result = applyOne(texts[0]) as number | string;
    }
    this.cachedResult = result;
    return { result };
  }
}

// ─── DOLLAR (format number as currency string) ────────────────────────────────

export class FormatDollarNode extends ClassicPreset.Node {
  label: string;
  cachedText: CellResult<string> = null;
  literals: Record<string, number> = { number: 0 }; // decimals ships unset → muted "2" placeholder (data() defaults)
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("FormatDollar");
    this.label = init?.label ?? "DOLLAR";
    this.addInput("number",   numListIn("Number"));
    this.addInput("decimals", numListIn("Decimals (default 2)"));
    this.addOutput("result", strComboOut("Currency text"));
  }

  data(inputs: { number?: (number | number[])[]; decimals?: (number | number[])[] }): { result: CellResult<string> } {
    const result = broadcastCells((n: number, d: number) => {
      const rounded = Math.abs(n).toFixed(Math.max(0, Math.round(d)));
      const parts = rounded.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return (n < 0 ? "-$" : "$") + parts.join(".");
    },
      inputs.number?.[0]   ?? this.literals.number   ?? 0,
      inputs.decimals?.[0] ?? this.literals.decimals ?? 2);
    this.cachedText = result;
    return { result };
  }
}


// ─── Reverse Text (Timesavers pack) ───────────────────────────────────────────
// Excel famously has no string-reverse (the VBA StrReverse workaround) — a
// declared custom-logic pack node. Spread-iteration keeps surrogate pairs
// (emoji) intact.

export class ReverseTextNode extends ClassicPreset.Node {
  label: string;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 190; height = 135;

  constructor(init?: { label?: string }) {
    super("ReverseText");
    this.label = init?.label ?? "Reverse Text";
    this.addInput("text", strComboIn("Text"));
    this.addOutput("result", strComboOut("Reversed"));
  }

  data(inputs: { text?: (string | string[])[] }): { result: CellResult<string> } {
    const result = broadcastCells(
      (t: string) => [...t].reverse().join(""),
      strVal(inputs.text, this, "text"),
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── Spell Number (Timesavers pack) ───────────────────────────────────────────
// Number → English words — the perennial #1 "no Excel function" request
// (Microsoft's own answer is a VBA SpellNumber macro). Cardinal words up to
// the trillions; decimals read digit-by-digit ("three point one four");
// negatives prefixed. A custom-logic pack node (no Formula.js equivalent).

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

export class SpellNumberNode extends ClassicPreset.Node {
  label: string;
  cachedText: CellResult<string> = null;
  literals: Record<string, number> = { value: 0 };
  width = 210; height = 135;

  constructor(init?: { label?: string }) {
    super("SpellNumber");
    this.label = init?.label ?? "Spell Number";
    this.addInput("value", numListIn("Number"));
    this.addOutput("result", strComboOut("Words"));
  }

  data(inputs: { value?: (number | number[] | null)[] }): { result: CellResult<string> } {
    // `readInput` semantics: a CONNECTED cable wins even when its value is null
    // (which the broadcaster short-circuits per the missing contract); only an
    // unwired slot falls back to the literal.
    const value = inputs.value === undefined || inputs.value.length === 0
      ? this.literals.value
      : inputs.value[0] ?? null;
    const result = broadcastCells((v: number) => spellNumber(v), value);
    this.cachedText = result;
    return { result };
  }
}
