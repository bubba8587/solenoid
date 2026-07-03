import { ClassicPreset } from "rete";
import { stringSocket } from "../sockets";
import { strIn, strOut, strListIn, strListOut, numIn, numOut, logicalOut, anyIn, anyOut } from "./shared";
import { getRecalcGen } from "../process";
import { solError, type SolError } from "../errorValue";
import { resolveExcelFunction } from "../excelFunctions";

// Reads a string from either a wired input or the node's stringLiterals fallback.
function strVal(
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
  "No more =SUM(A1:A8) — just plug it in.",
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
  upper:  { label: "UPPER",  description: "Convert all characters to uppercase   (Excel: =UPPER)" },
  lower:  { label: "LOWER",  description: "Convert all characters to lowercase   (Excel: =LOWER)" },
  trim:   { label: "TRIM",   description: "Remove leading/trailing spaces and collapse internal spaces   (Excel: =TRIM)" },
  proper: { label: "PROPER", description: "Capitalize the first letter of each word   (Excel: =PROPER)" },
  clean:  { label: "CLEAN",  description: "Remove non-printable control characters (ASCII 0–31)   (Excel: =CLEAN)" },
} satisfies Record<TextTransformOp, { label: string; description: string }>;

// UPPER/LOWER/TRIM are verified byte-identical to Formula.js, so those three route
// through the shared seam. PROPER stays hand-rolled: FX's PROPER only capitalizes
// after certain separators, not Excel's "after any non-letter" rule (verified
// divergence, e.g. "a-b_c.d" → ours "A-B_c.D", FX "A-b_c.d"). CLEAN has no Formula.js
// equivalent. Shared by TextTransformNode (scalar) and TextMapNode (per-element).
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
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 170;

  constructor(init?: { label?: string; op?: TextTransformOp }) {
    super("TextTransform");
    this.label = init?.label ?? "UPPER";
    this.op    = init?.op    ?? "upper";
    this.addInput("text", strIn("Text"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { text?: string[] }): { result: string | null } {
    const text = strVal(inputs.text, this, "text");
    const result = applyTextTransform(this.op, text);
    this.cachedText = result;
    return { result };
  }
}

// ─── LEN ──────────────────────────────────────────────────────────────────────

export class TextLenNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 135;

  constructor(init?: { label?: string }) {
    super("TextLen");
    this.label = init?.label ?? "LEN";
    this.addInput("text", strIn("Text"));
    this.addOutput("result", numOut("Length"));
  }

  data(inputs: { text?: string[] }): { result: number } {
    const text = strVal(inputs.text, this, "text");
    const result = resolveExcelFunction("LEN")!(text) as number;
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
  left:  { label: "LEFT",  description: "First N characters   (Excel: =LEFT)" },
  right: { label: "RIGHT", description: "Last N characters   (Excel: =RIGHT)" },
  mid:   { label: "MID",   description: "Substring starting at position Start with length Len (1-based)   (Excel: =MID)" },
} satisfies Record<TextSliceOp, { label: string; description: string }>;

export class TextSliceNode extends ClassicPreset.Node {
  label: string;
  op: TextSliceOp;
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { n: 1, start: 1, len: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: TextSliceOp }) {
    super("TextSlice");
    this.label = init?.label ?? "LEFT";
    this.op    = init?.op    ?? "left";
    this.addInput("text",  strIn("Text"));
    this.addInput("n",     numIn("N (LEFT/RIGHT)"));
    this.addInput("start", numIn("Start (MID)"));
    this.addInput("len",   numIn("Len (MID)"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { text?: string[]; n?: number[]; start?: number[]; len?: number[] }): { result: string } {
    const text  = strVal(inputs.text, this, "text");
    const n     = Math.max(0, Math.floor(inputs.n?.[0]     ?? this.literals.n     ?? 1));
    const start = Math.max(1, Math.floor(inputs.start?.[0] ?? this.literals.start ?? 1));
    const len   = Math.max(0, Math.floor(inputs.len?.[0]   ?? this.literals.len   ?? 1));
    let result: string;
    switch (this.op) {
      case "left":  result = resolveExcelFunction("LEFT")!(text, n) as string; break;
      case "right": result = resolveExcelFunction("RIGHT")!(text, n) as string; break;
      // Formula.js MID errors on num_chars = 0 (a real Excel input that returns "") —
      // guard that one edge, delegate the rest (verified byte-identical otherwise).
      case "mid":   result = len === 0 ? "" : resolveExcelFunction("MID")!(text, start, len) as string; break;
    }
    this.cachedText = result;
    return { result };
  }
}

// ─── FIND / SEARCH ────────────────────────────────────────────────────────────

export type TextFindOp = "find" | "search";

export const TEXT_FIND_OP_META = {
  find:   { label: "FIND",   description: "1-based position of find_text in within_text (case-sensitive); null if not found   (Excel: =FIND)" },
  search: { label: "SEARCH", description: "1-based position of find_text in within_text (case-insensitive); null if not found   (Excel: =SEARCH)" },
} satisfies Record<TextFindOp, { label: string; description: string }>;

export class TextFindNode extends ClassicPreset.Node {
  label: string;
  op: TextFindOp;
  cachedResult: number | SolError | null = null;
  stringLiterals: Record<string, string> = { needle: "", haystack: "" };
  literals: Record<string, number> = { start: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: TextFindOp }) {
    super("TextFind");
    this.label = init?.label ?? "FIND";
    this.op    = init?.op    ?? "find";
    this.addInput("needle",   strIn("Find text"));
    this.addInput("haystack", strIn("Within text"));
    this.addInput("start",    numIn("Start (optional)"));
    this.addOutput("result", numOut("Position"));
  }

  data(inputs: { needle?: string[]; haystack?: string[]; start?: number[] }): { result: number | SolError | null } {
    const needle   = strVal(inputs.needle,   this, "needle");
    const haystack = strVal(inputs.haystack, this, "haystack");
    const start    = Math.max(1, Math.floor(inputs.start?.[0] ?? this.literals.start ?? 1));
    const raw = resolveExcelFunction(this.op === "find" ? "FIND" : "SEARCH")!(needle, haystack, start);
    // Excel FIND/SEARCH return #VALUE! when the substring is absent — Formula.js
    // signals the same case as an Error, so map it to our tagged SolError (and the
    // formula path's FIND via Formula.js → #VALUE! too), keeping node == formula == Excel.
    if (raw instanceof Error) {
      const err = solError("#VALUE!", "Find text not found within the text");
      this.cachedResult = err;
      return { result: err };
    }
    const result = raw as number;
    this.cachedResult = result;
    return { result };
  }
}

// ─── SUBSTITUTE ───────────────────────────────────────────────────────────────

export class SubstituteNode extends ClassicPreset.Node {
  label: string;
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { text: "", old_text: "", new_text: "" };
  width = 180; height = 225;

  constructor(init?: { label?: string }) {
    super("Substitute");
    this.label = init?.label ?? "SUBSTITUTE";
    this.addInput("text",     strIn("Text"));
    this.addInput("old_text", strIn("Old text"));
    this.addInput("new_text", strIn("New text"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { text?: string[]; old_text?: string[]; new_text?: string[] }): { result: string } {
    const text     = strVal(inputs.text,     this, "text");
    const oldText  = strVal(inputs.old_text, this, "old_text");
    const newText  = strVal(inputs.new_text, this, "new_text");
    const result   = resolveExcelFunction("SUBSTITUTE")!(text, oldText, newText) as string;
    this.cachedText = result;
    return { result };
  }
}

// ─── REPLACE ─────────────────────────────────────────────────────────────────

export class TextReplaceNode extends ClassicPreset.Node {
  label: string;
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { text: "", new_text: "" };
  literals: Record<string, number> = { start: 1, num_chars: 1 };
  width = 180; height = 250;

  constructor(init?: { label?: string }) {
    super("TextReplace");
    this.label = init?.label ?? "REPLACE";
    this.addInput("text",      strIn("Text"));
    this.addInput("start",     numIn("Start"));
    this.addInput("num_chars", numIn("Num chars"));
    this.addInput("new_text",  strIn("New text"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { text?: string[]; start?: number[]; num_chars?: number[]; new_text?: string[] }): { result: string } {
    const text     = strVal(inputs.text,     this, "text");
    const newText  = strVal(inputs.new_text, this, "new_text");
    const start    = Math.max(1, Math.floor(inputs.start?.[0]     ?? this.literals.start     ?? 1));
    const numChars = Math.max(0, Math.floor(inputs.num_chars?.[0] ?? this.literals.num_chars ?? 1));
    const result   = resolveExcelFunction("REPLACE")!(text, start, numChars, newText) as string;
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
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { times: 1 };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("Rept");
    this.label = init?.label ?? "REPT";
    this.addInput("text",  strIn("Text"));
    this.addInput("times", numIn("Times"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { text?: string[]; times?: number[] }): { result: string } {
    const text  = strVal(inputs.text, this, "text");
    const times = Math.max(0, Math.floor(inputs.times?.[0] ?? this.literals.times ?? 1));
    const result = resolveExcelFunction("REPT")!(text, times) as string;
    this.cachedText = result;
    return { result };
  }
}

// ─── CHAR / CODE ─────────────────────────────────────────────────────────────

export type CharCodeOp = "char" | "code";

export class CharCodeNode extends ClassicPreset.Node {
  label: string;
  op: CharCodeOp;
  cachedResult: string | number | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { code: 65 };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: CharCodeOp }) {
    super("CharCode");
    this.op = init?.op ?? "char";
    this.label = init?.label ?? (this.op === "char" ? "CHAR" : "CODE");
    if (this.op === "char") {
      this.addInput("code", numIn("Code point"));
      this.addOutput("result", strOut("Character"));
    } else {
      this.addInput("text", strIn("Text"));
      this.addOutput("result", numOut("Code point"));
    }
  }

  data(inputs: { code?: number[]; text?: string[] }): { result: string | number | null } {
    if (this.op === "char") {
      const n = Math.floor(inputs.code?.[0] ?? this.literals.code ?? 65);
      try {
        const result = String.fromCodePoint(n);
        this.cachedResult = result;
        return { result };
      } catch {
        this.cachedResult = null;
        return { result: null };
      }
    } else {
      const text = strVal(inputs.text, this, "text");
      const result = text.length > 0 ? (text.codePointAt(0) ?? null) : null;
      this.cachedResult = result;
      return { result };
    }
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
    const delimiter = strVal(inputs.delimiter, this, "delimiter");
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
    const text      = strVal(inputs.text,      this, "text");
    const delimiter = strVal(inputs.delimiter, this, "delimiter");
    const result    = delimiter === "" ? [...text] : text.split(delimiter);
    this.cachedResult = result;
    return { result };
  }
}

// ─── TEXTAFTER / TEXTBEFORE ───────────────────────────────────────────────────

export type TextAfterBeforeOp = "after" | "before";

export const TEXT_AFTER_BEFORE_OP_META = {
  after:  { label: "TEXTAFTER",  description: "Text after the first occurrence of delimiter — null if not found   (Excel: =TEXTAFTER)" },
  before: { label: "TEXTBEFORE", description: "Text before the first occurrence of delimiter — null if not found   (Excel: =TEXTBEFORE)" },
} satisfies Record<TextAfterBeforeOp, { label: string; description: string }>;

export class TextAfterBeforeNode extends ClassicPreset.Node {
  label: string;
  op: TextAfterBeforeOp;
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { text: "", delimiter: "" };
  width = 180; height = 205;

  constructor(init?: { label?: string; op?: TextAfterBeforeOp }) {
    super("TextAfterBefore");
    this.op    = init?.op    ?? "after";
    this.label = init?.label ?? TEXT_AFTER_BEFORE_OP_META[this.op].label;
    this.addInput("text",      strIn("Text"));
    this.addInput("delimiter", strIn("Delimiter"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { text?: string[]; delimiter?: string[] }): { result: string | null } {
    const text      = strVal(inputs.text,      this, "text");
    const delimiter = strVal(inputs.delimiter, this, "delimiter");
    if (delimiter === "") { this.cachedText = null; return { result: null }; }
    const idx = text.indexOf(delimiter);
    if (idx === -1)       { this.cachedText = null; return { result: null }; }
    const result = this.op === "after"
      ? text.slice(idx + delimiter.length)
      : text.slice(0, idx);
    this.cachedText = result;
    return { result };
  }
}

// ─── EXACT ────────────────────────────────────────────────────────────────────

export class ExactNode extends ClassicPreset.Node {
  label: string;
  cachedResult: boolean | null = null;
  stringLiterals: Record<string, string> = { a: "", b: "" };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("Exact");
    this.label = init?.label ?? "EXACT";
    this.addInput("a", strIn("Text 1"));
    this.addInput("b", strIn("Text 2"));
    // A first-class logical (TRUE/FALSE) like Excel EXACT — not 1/0. Coerces to 1/0
    // anywhere a number is wanted (the logical↔number socket bridge).
    this.addOutput("result", logicalOut("Result"));
  }

  data(inputs: { a?: string[]; b?: string[] }): { result: boolean } {
    const a = strVal(inputs.a, this, "a");
    const b = strVal(inputs.b, this, "b");
    const result = a === b;
    this.cachedResult = result;
    return { result };
  }
}

// ─── TEXTFILTER ──────────────────────────────────────────────────────────────

export type TextFilterOp = "contains" | "not_contains" | "starts_with" | "ends_with";

export const TEXT_FILTER_OP_META = {
  contains:     { label: "Contains",     description: "Keep strings that contain the pattern (case-sensitive)" },
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
  cachedResult: number | SolError | null = null;
  stringLiterals: Record<string, string> = { text: "", decimal_sep: ".", group_sep: "," };
  width = 180; height = 195;

  constructor(init?: { label?: string }) {
    super("NumberValue");
    this.label = init?.label ?? "NUMBERVALUE";
    this.addInput("text",        strIn("Text"));
    this.addInput("decimal_sep", strIn("Decimal sep (default \".\")"));
    this.addInput("group_sep",   strIn("Group sep (default \",\")"));
    this.addOutput("result", numOut("Number"));
  }

  data(inputs: { text?: string[]; decimal_sep?: string[]; group_sep?: string[] }): { result: number | SolError | null } {
    const text    = (inputs.text?.[0]        ?? this.stringLiterals.text        ?? "").trim();
    const decSep  =  inputs.decimal_sep?.[0] ?? this.stringLiterals.decimal_sep ?? ".";
    const grpSep  =  inputs.group_sep?.[0]   ?? this.stringLiterals.group_sep   ?? ",";
    // Empty input is blank (null); a non-empty string that won't parse is a
    // genuine #VALUE! error.
    if (!text) { this.cachedResult = null; return { result: null }; }
    const normalized = text
      .split(grpSep).join("")
      .split(decSep).join(".");
    const n = parseFloat(normalized);
    if (!Number.isFinite(n)) {
      const err = solError("#VALUE!", `Cannot parse "${text}" as a number`);
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = n;
    return { result: n };
  }
}

// ─── TEXTMAP (apply transform to each string in a list) ──────────────────────

export class TextMapNode extends ClassicPreset.Node {
  label: string;
  op: TextTransformOp;
  cachedResult: string[] | null = null;
  width = 180; height = 170;

  constructor(init?: { label?: string; op?: TextTransformOp }) {
    super("TextMap");
    this.op    = init?.op    ?? "upper";
    this.label = init?.label ?? `${TEXT_TRANSFORM_OP_META[this.op].label} (list)`;
    this.addInput("strings", strListIn("Strings"));
    this.addOutput("result", strListOut("Result"));
  }

  data(inputs: { strings?: string[][] }): { result: string[] } {
    const strings = inputs.strings?.[0] ?? [];
    const result  = strings.map(s => applyTextTransform(this.op, s));
    this.cachedResult = result;
    return { result };
  }
}

// ─── ENCODEURL / DECODEURL ────────────────────────────────────────────────────

export type UrlEncodeOp = "encode" | "decode";

export class UrlEncodeNode extends ClassicPreset.Node {
  label: string;
  op: UrlEncodeOp;
  cachedText: string | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: UrlEncodeOp }) {
    super("UrlEncode");
    this.op    = init?.op ?? "encode";
    this.label = init?.label ?? (this.op === "encode" ? "ENCODEURL" : "DECODEURL");
    this.addInput("text", strIn("Text"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { text?: string[] }): { result: string } {
    const text = inputs.text?.[0] ?? this.stringLiterals.text ?? "";
    let result: string;
    try {
      result = this.op === "encode" ? encodeURIComponent(text) : decodeURIComponent(text);
    } catch {
      result = text;
    }
    this.cachedText = result;
    return { result };
  }
}

// ─── ROMAN / ARABIC ───────────────────────────────────────────────────────────

export type RomanArabicOp = "roman" | "arabic";

export class RomanArabicNode extends ClassicPreset.Node {
  label: string;
  op: RomanArabicOp;
  cachedResult: string | number | SolError | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { number: 1 };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: RomanArabicOp }) {
    super("RomanArabic");
    this.op    = init?.op ?? "roman";
    this.label = init?.label ?? (this.op === "roman" ? "ROMAN" : "ARABIC");
    if (this.op === "roman") {
      this.addInput("number", numIn("Number (1–3999)"));
      this.addOutput("result", strOut("Roman numeral"));
    } else {
      this.addInput("text", strIn("Roman numeral"));
      this.addOutput("result", numOut("Number"));
    }
  }

  data(inputs: { number?: number[]; text?: string[] }): { result: string | number | SolError | null } {
    if (this.op === "roman") {
      const n = Math.floor(inputs.number?.[0] ?? this.literals.number ?? 1);
      // ROMAN only spans 1–3999; anything else is out of range (#VALUE!).
      if (n < 1 || n > 3999) {
        const err = solError("#VALUE!", "ROMAN is defined only for 1–3999");
        this.cachedResult = err;
        return { result: err };
      }
      const vals = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
      const syms = ["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
      let result = ""; let rem = n;
      for (let i = 0; i < vals.length; i++) {
        while (rem >= vals[i]) { result += syms[i]; rem -= vals[i]; }
      }
      this.cachedResult = result;
      return { result };
    } else {
      const text = (inputs.text?.[0] ?? this.stringLiterals.text ?? "").toUpperCase().trim();
      // Empty input is blank (null). A non-empty string with a non-Roman
      // character is an invalid numeral (#VALUE!).
      if (!text) { this.cachedResult = null; return { result: null }; }
      const map: Record<string, number> = { M:1000, D:500, C:100, L:50, X:10, V:5, I:1 };
      let result = 0; let prev = 0;
      for (let i = text.length - 1; i >= 0; i--) {
        const v = map[text[i]];
        if (v === undefined) {
          const err = solError("#VALUE!", `"${text}" is not a valid Roman numeral`);
          this.cachedResult = err;
          return { result: err };
        }
        if (v < prev) result -= v; else { result += v; prev = v; }
      }
      this.cachedResult = result;
      return { result };
    }
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
  cachedText: string | null = null;
  literals: Record<string, number> = { number: 0, decimals: 2 };
  width = 180; height = 175;

  constructor(init?: { label?: string; noCommas?: FixedNoCommas }) {
    super("Fixed");
    this.label    = init?.label    ?? "FIXED";
    this.noCommas = init?.noCommas ?? "commas";
    this.addInput("number",   numIn("Number"));
    this.addInput("decimals", numIn("Decimals (default 2)"));
    this.addOutput("result", strOut("Text"));
  }

  data(inputs: { number?: number[]; decimals?: number[] }): { result: string } {
    const n      = inputs.number?.[0]   ?? this.literals.number   ?? 0;
    const dec    = Math.max(0, Math.floor(inputs.decimals?.[0] ?? this.literals.decimals ?? 2));
    const result = resolveExcelFunction("FIXED")!(n, dec, this.noCommas === "no_commas") as string;
    this.cachedText = result;
    return { result };
  }
}


// ─── REGEX (REGEXTEST / REGEXEXTRACT / REGEXREPLACE) ─────────────────────────

export type RegexOp = "test" | "extract" | "extract_all" | "replace";

export const REGEX_OP_META: Record<RegexOp, { label: string; description: string }> = {
  test:        { label: "REGEXTEST",         description: "Returns 1 if text matches the pattern, else 0. Wired list input broadcasts element-wise.   (Excel 365: =REGEXTEST)" },
  extract:     { label: "REGEXEXTRACT",      description: "Returns the first match found in text, or empty string if none. Wired list input returns a list of first matches.   (Excel 365: =REGEXEXTRACT)" },
  extract_all: { label: "REGEXEXTRACT (all)", description: "Returns all matches found in a single string as a list.   (Excel 365: =REGEXEXTRACT with return_all=TRUE)" },
  replace:     { label: "REGEXREPLACE",      description: "Replaces all regex matches with the replacement string. Wired list input broadcasts element-wise.   (Excel 365: =REGEXREPLACE)" },
};

function safeRegex(pattern: string, flags: string): RegExp | null {
  try { return new RegExp(pattern, flags); } catch { return null; }
}

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
    this.addInput("text",        anyIn("Text"));
    this.addInput("pattern",     strIn("Pattern"));
    this.addInput("replacement", strIn("Replace with"));
    this.addOutput("result", anyOut("Result"));
  }

  data(inputs: {
    text?: unknown[];
    pattern?: string[];
    replacement?: string[];
  }): { result: number | number[] | string | string[] | null } {
    const pattern     = inputs.pattern?.[0]     ?? this.stringLiterals.pattern     ?? "";
    const replacement = inputs.replacement?.[0] ?? this.stringLiterals.replacement ?? "";
    const flags       = this.stringLiterals.flags ?? "";

    if (!pattern) { this.cachedResult = null; return { result: null }; }
    const re = safeRegex(pattern, flags);
    if (!re) { this.cachedResult = null; return { result: null }; }

    const rawText = inputs.text?.[0];
    const isList  = Array.isArray(rawText);
    const texts   = isList ? (rawText as unknown[]).map(String) : [String(rawText ?? "")];

    const applyOne = (t: string): number | string | string[] => {
      switch (this.op) {
        case "test":        return re.test(t) ? 1 : 0;
        case "extract": {
          const m = t.match(re);
          return m ? m[0] : "";
        }
        case "extract_all": {
          const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
          return [...t.matchAll(gre)].map((m) => m[0]);
        }
        case "replace": {
          const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
          return t.replace(gre, replacement);
        }
      }
    };

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
  cachedText: string | null = null;
  literals: Record<string, number> = { number: 0, decimals: 2 };
  width = 180; height = 175;

  constructor(init?: { label?: string }) {
    super("FormatDollar");
    this.label = init?.label ?? "DOLLAR";
    this.addInput("number",   numIn("Number"));
    this.addInput("decimals", numIn("Decimals (default 2)"));
    this.addOutput("result", strOut("Currency text"));
  }

  data(inputs: { number?: number[]; decimals?: number[] }): { result: string } {
    const n   = inputs.number?.[0]   ?? this.literals.number   ?? 0;
    const dec = Math.max(0, Math.round(inputs.decimals?.[0] ?? this.literals.decimals ?? 2));
    const rounded = Math.abs(n).toFixed(dec);
    const parts = rounded.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const formatted = parts.join(".");
    const result = (n < 0 ? "-$" : "$") + formatted;
    this.cachedText = result;
    return { result };
  }
}

