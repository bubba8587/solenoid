import { ClassicPreset } from "rete";
import { stringSocket } from "../sockets";
import {
  strIn, strOut, strListIn, strListOut, anyListIn, anyComboOut,
  strComboIn, strComboOut, numIn, numListIn, numListOut, logicalComboOut,
  broadcastCells, readInput, type CellResult, type BroadcastResult,
} from "./shared";
import { getRecalcGen } from "../process";
import { hashText, uuidV4, type HashAlgorithm } from "./hashOps";
export { HASH_ALGORITHM_META } from "./hashOps";
export type { HashAlgorithm } from "./hashOps";
import { solError, isSolError, type SolError } from "../errorValue";
import { resolveExcelFunction } from "../excelFunctions";
// The pure ops, shared verbatim with the formula surface; re-exported so the node
// barrel keeps its shape.
import { splitText, textAfterBefore, urlEncode, regexApply, replaceNth, safeRegex, reverseText, unaccent, slugify, padText, truncateText, wrapText, templatePlaceholders, renderTemplate, templateFormat, type TemplateFormatters } from "./textOps";
import { anyDataIn } from "./shared";
import { dropInputCables } from "../components/cablePrune";
import { getActiveArea } from "../activeGraph";
import { SolenoidSocket } from "../sockets";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "./date";
import type { TextAfterBeforeOp, UrlEncodeOp, RegexOp, PadSide } from "./textOps";
export type { PadSide } from "./textOps";
export { splitText, textAfterBefore, urlEncode, regexApply } from "./textOps";
export type { TextAfterBeforeOp, UrlEncodeOp, RegexOp } from "./textOps";

// ─── Element-wise text: the `strcombo` (scalar-or-list) sockets ───────────────
// Every text OPERAND is a `strcombo` and broadcasts, matching Excel's array-formula
// spill; a scalar in still yields a scalar out.
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
//    can't take a family combo. It emits `anycombo` (the element-agnostic combo) —
//    a scalar `any` would draw a SCALAR circle on a port that REGEXEXTRACT-all and
//    the list path can both spill a list from.

// A `strcombo` input may deliver a LIST, so this yields `string | string[]` and the
// broadcaster zips whichever shape arrives.
function strVal(
  input: (string | string[])[] | undefined,
  node: { stringLiterals?: Record<string, string> },
  key: string,
  def = "",
): string | string[] | null {
  // `readInput`, NOT `?? literal`: a WIRED blank must propagate instead of being
  // swallowed by whatever text sits in the box.
  return readInput(input, node.stringLiterals?.[key] ?? def);
}

/** The read for a scalar `string` socket (a delimiter, separator, pattern) the lattice
 *  can never deliver a list to. Like `strVal` it uses `readInput`, so a WIRED blank
 *  propagates (an unknown mode gives an unknown answer, e.g. TEXTSPLIT(x, blank) → blank);
 *  only the return type differs (never a list). */
function strScalar(
  input: string[] | undefined,
  node: { stringLiterals?: Record<string, string> },
  key: string,
  def = "",
): string | null {
  return readInput(input, node.stringLiterals?.[key] ?? def);
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
// A no-input tagline source. Volatile: re-rolls on recalc, like the RAND family.
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

export type TextTransformOp = "upper" | "lower" | "trim" | "proper" | "clean" | "unaccent" | "slugify";

export const TEXT_TRANSFORM_OP_META = {
  upper:  { label: "UPPER",  description: "Converts all characters to uppercase. Excel: UPPER." },
  lower:  { label: "LOWER",  description: "Converts all characters to lowercase. Excel: LOWER." },
  trim:   { label: "TRIM",   description: "Removes leading and trailing spaces and collapses internal spaces. Excel: TRIM." },
  proper: { label: "PROPER", description: "Capitalize the first letter of each word. Excel: PROPER." },
  clean:  { label: "CLEAN",  description: "Removes non-printable control characters (ASCII 0–31). Excel: CLEAN." },
  unaccent: { label: "UNACCENT", description: "Strips accents and diacritics: Crème Brûlée → Creme Brulee. unidecode, R stri_trans_general Latin-ASCII." },
  slugify:  { label: "SLUGIFY",  description: "URL / filename slug: accents stripped, lowercase, every non-alphanumeric run a hyphen. python-slugify, R make_clean_names." },
} satisfies Record<TextTransformOp, { label: string; description: string }>;

// PROPER stays hand-rolled: FX capitalizes only after certain separators, not Excel's
// "after any non-letter" rule ("a-b_c.d" → ours "A-B_c.D", FX "A-b_c.d").
function applyTextTransform(op: TextTransformOp, text: string): string {
  switch (op) {
    case "upper": return resolveExcelFunction("UPPER")!(text) as string;
    case "lower": return resolveExcelFunction("LOWER")!(text) as string;
    case "trim":  return resolveExcelFunction("TRIM")!(text) as string;
    case "proper": return text.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
    case "clean":  return text.replace(/[\x00-\x1F\x7F]/g, "");
    case "unaccent": return unaccent(text);
    case "slugify":  return slugify(text);
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
    this.label = init?.label ?? "";
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

// ─── Pad Text / Truncate Text (no Excel equivalent; Python ljust/rjust/center, R str_pad / str_trunc) ───

export const PAD_SIDE_META = {
  left:   { label: "Left",   description: "Padding goes on the left — right-justified text. Python rjust, R str_pad side = left." },
  right:  { label: "Right",  description: "Padding goes on the right — left-justified text. Python ljust, R str_pad side = right." },
  center: { label: "Center", description: "Padding splits both sides, the odd character on the right. Python center, R str_pad side = both." },
} satisfies Record<PadSide, { label: string; description: string }>;

export class PadTextNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    width: "Target length in characters; text already that long passes through unchanged.",
    fill:  "Repeated to fill the gap; blank means a space.",
  };
  label: string;
  op: PadSide;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "", fill: "" };
  literals: Record<string, number> = { width: 10 };
  width = 190; height = 210;

  constructor(init?: { label?: string; op?: PadSide }) {
    super("PadText");
    this.label = init?.label ?? "Pad Text";
    this.op = init?.op ?? "right";
    this.addInput("text",  strComboIn("Text"));
    this.addInput("width", numIn("Width"));
    this.addInput("fill",  strIn("Fill"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: { text?: (string | string[])[]; width?: number[]; fill?: string[] }): { result: CellResult<string> } {
    const w = readInput(inputs.width, this.literals.width ?? 10);
    const fill = strScalar(inputs.fill, this, "fill");
    if (w === null || fill === null) { this.cachedText = null; return { result: null }; }
    const result = broadcastCells((t: string) => padText(t, w, this.op, fill), strVal(inputs.text, this, "text"));
    this.cachedText = result;
    return { result };
  }
}

export class TruncateTextNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    width:    "Maximum length in characters, the ellipsis included.",
    ellipsis: "Appended when anything was cut; blank for a plain cut.",
  };
  label: string;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "", ellipsis: "…" };
  literals: Record<string, number> = { width: 20 };
  width = 190; height = 210;

  constructor(init?: { label?: string }) {
    super("TruncateText");
    this.label = init?.label ?? "Truncate Text";
    this.addInput("text",     strComboIn("Text"));
    this.addInput("width",    numIn("Width"));
    this.addInput("ellipsis", strIn("Ellipsis"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: { text?: (string | string[])[]; width?: number[]; ellipsis?: string[] }): { result: CellResult<string> } {
    const w = readInput(inputs.width, this.literals.width ?? 20);
    const e = strScalar(inputs.ellipsis, this, "ellipsis", "…");
    if (w === null || e === null) { this.cachedText = null; return { result: null }; }
    const result = broadcastCells((t: string) => truncateText(t, w, e), strVal(inputs.text, this, "text"));
    this.cachedText = result;
    return { result };
  }
}

// ─── Wrap Text (no Excel equivalent; R str_wrap, Python textwrap.wrap) ─────────

export class WrapTextNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    width: "Maximum line length in characters; a single word longer than this still takes its own line.",
  };
  label: string;
  cachedResult: string[] | SolError | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { width: 40 };
  width = 190; height = 175;

  constructor(init?: { label?: string }) {
    super("WrapText");
    this.label = init?.label ?? "Wrap Text";
    this.addInput("text",  strIn("Text"));
    this.addInput("width", numIn("Width"));
    this.addOutput("result", strListOut("Lines"));
  }

  data(inputs: { text?: string[]; width?: number[] }): { result: string[] | SolError | null } {
    const text = strScalar(inputs.text, this, "text");
    const w = readInput(inputs.width, this.literals.width ?? 40);
    if (text === null || w === null) { this.cachedResult = null; return { result: null }; }
    if (w < 1) { const e = solError("#DOMAIN!", "Width must be at least 1"); this.cachedResult = e; return { result: e }; }
    const result = wrapText(text, w);
    this.cachedResult = result;
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
  // `nextInputId` keeps extensible-row keys unique across removals.
  nextInputId = 0;
  readonly valueSocket = stringSocket;
  width = 180; height = 225;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("Concat");
    this.label = init?.label ?? "CONCAT";
    // Load/paste must rebuild the EXACT keys or saved literals + cables misalign.
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
    // A REDUCER, so a missing is SKIPPED, not propagated; `readInput` first, or a
    // WIRED blank would resurrect the text typed in that row's box.
    const values = Object.keys(this.inputs).map((key) => readInput(inputs[key], this.stringLiterals[key] ?? "") ?? "");
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
  static socketDocs: Record<string, string> = {
    n: "Read by LEFT and RIGHT: the number of characters to take.",
    start: "Read by MID: position 1 is the first character.",
    len: "Read by MID: the number of characters to take.",
  };

  label: string;
  op: TextSliceOp;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { n: 1, start: 1, len: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: TextSliceOp }) {
    super("TextSlice");
    this.label = init?.label ?? "";
    this.op    = init?.op    ?? "left";
    this.addInput("text",  strComboIn("Text"));
    this.addInput("n",     numListIn("N"));
    this.addInput("start", numListIn("Start"));
    this.addInput("len",   numListIn("Len"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: {
    text?: (string | string[])[];
    n?: (number | number[])[];
    start?: (number | number[])[];
    len?: (number | number[])[];
  }): { result: CellResult<string> } {
    const text = strVal(inputs.text, this, "text");
    // Only the CHOSEN op's operands join the zip, or a list left in an unused MID box
    // would spill a LEFT result.
    const result = this.op === "mid"
      ? broadcastCells((t: string, s: number, l: number) => {
          const len = Math.max(0, Math.floor(l));
          // Formula.js MID errors on num_chars = 0, which Excel returns "" for.
          return len === 0 ? "" : resolveExcelFunction("MID")!(t, Math.max(1, Math.floor(s)), len) as string;
        },
        text,
        readInput(inputs.start, this.literals.start ?? 1),
        readInput(inputs.len,   this.literals.len   ?? 1))
      : broadcastCells((t: string, count: number) => {
          const fn = this.op === "left" ? "LEFT" : "RIGHT";
          return resolveExcelFunction(fn)!(t, Math.max(0, Math.floor(count))) as string;
        },
        text,
        readInput(inputs.n, this.literals.n ?? 1));
    this.cachedText = result;
    return { result };
  }
}

// ─── FIND / SEARCH ────────────────────────────────────────────────────────────

export type TextFindOp = "find" | "search";

export const TEXT_FIND_OP_META = {
  find:   { label: "FIND",   description: "1-based position of find_text in within_text (case-sensitive). #VALUE! if not found. Excel: FIND." },
  search: { label: "SEARCH", description: "1-based position of find_text in within_text (case-insensitive). #VALUE! if not found. Excel: SEARCH." },
} satisfies Record<TextFindOp, { label: string; description: string }>;

export class TextFindNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    start: "Counting starts at 1. The position found is still measured from the start of the whole text.",
  };

  label: string;
  op: TextFindOp;
  cachedResult: BroadcastResult = null;
  stringLiterals: Record<string, string> = { needle: "", haystack: "" };
  literals: Record<string, number> = { start: 1 };
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: TextFindOp }) {
    super("TextFind");
    this.label = init?.label ?? "";
    this.op    = init?.op    ?? "find";
    this.addInput("needle",   strComboIn("Find text"));
    this.addInput("haystack", strComboIn("Within text"));
    this.addInput("start",    numListIn("Start"));
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
      // Excel returns #VALUE! for an absent substring, which Formula.js signals as an
      // Error — map it per CELL so one unmatched string doesn't fail the whole result.
      return raw instanceof Error
        ? solError("#VALUE!", "Find text not found within the text")
        : raw as number;
    },
      strVal(inputs.needle,   this, "needle"),
      strVal(inputs.haystack, this, "haystack"),
      readInput(inputs.start, this.literals.start ?? 1));
    this.cachedResult = result;
    return { result };
  }
}

// ─── SUBSTITUTE ───────────────────────────────────────────────────────────────

export class SubstituteNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    old_text: "Matches are case sensitive.",
    instance: "Which occurrence to replace (1 = the first). Blank or 0 replaces every occurrence.",
  };

  label: string;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "", old_text: "", new_text: "" };
  literals: Record<string, number> = { instance: 0 };
  width = 180; height = 250;

  constructor(init?: { label?: string }) {
    super("Substitute");
    this.label = init?.label ?? "SUBSTITUTE";
    this.addInput("text",     strComboIn("Text"));
    this.addInput("old_text", strComboIn("Old text"));
    this.addInput("new_text", strComboIn("New text"));
    this.addInput("instance", numListIn("Instance"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: {
    text?: (string | string[])[];
    old_text?: (string | string[])[];
    new_text?: (string | string[])[];
    instance?: (number | number[])[];
  }): { result: CellResult<string> } {
    // instance ≥ 1 replaces only that occurrence; blank/0 replaces every occurrence
    // (Excel's omitted-argument behavior). Called directly (not via a hoisted alias)
    // so the node↔formula arg-parity scan can see the 4th argument reach the impl.
    const result = broadcastCells(
      (text: string, oldText: string, newText: string, inst: number) => {
        const n = Math.floor(inst);
        return (n >= 1
          ? resolveExcelFunction("SUBSTITUTE")!(text, oldText, newText, n)
          : resolveExcelFunction("SUBSTITUTE")!(text, oldText, newText)) as string;
      },
      strVal(inputs.text,     this, "text"),
      strVal(inputs.old_text, this, "old_text"),
      strVal(inputs.new_text, this, "new_text"),
      readInput(inputs.instance, this.literals.instance ?? 0),
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── REPLACE ─────────────────────────────────────────────────────────────────

export class TextReplaceNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    start: "Position 1 is the first character.",
  };

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
      readInput(inputs.start,     this.literals.start     ?? 1),
      readInput(inputs.num_chars, this.literals.num_chars ?? 1),
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
 * TEXT node and Cast-to-text.
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
      readInput(inputs.times, this.literals.times ?? 1),
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── CHAR / CODE ─────────────────────────────────────────────────────────────

export type CharCodeOp = "char" | "code";

export class CharCodeNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    code: "Accepts the full Unicode range. Excel's CHAR stops at 255. An out-of-range value gives a blank.",
  };

  label: string;
  op: CharCodeOp;
  cachedResult: CellResult<string | number> = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { code: 65 };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: CharCodeOp }) {
    super("CharCode");
    this.op = init?.op ?? "char";
    this.label = init?.label ?? "";
    if (this.op === "char") {
      this.addInput("code", numListIn("Code point"));
      this.addOutput("result", strComboOut("Character"));
    } else {
      this.addInput("text", strComboIn("Text"));
      this.addOutput("result", numListOut("Code point"));
    }
  }

  data(inputs: { code?: (number | number[])[]; text?: (string | string[])[] }): { result: CellResult<string | number> } {
    // An out-of-range code point is a per-cell blank, not a whole-list one.
    const result: CellResult<string | number> = this.op === "char"
      ? broadcastCells((c: number) => {
          try { return String.fromCodePoint(Math.floor(c)); } catch { return null; }
        }, readInput(inputs.code, this.literals.code ?? 65))
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
    // Default matches the formula surface's ignore_empty=TRUE fallback (oneAnswerOneDivergence: one
    // computation, one answer — a bare TEXTJOIN must not differ node vs formula), and
    // skipping empties is TEXTJOIN's whole point over CONCAT.
    this.ignoreEmpty = init?.ignoreEmpty ?? "ignore";
    this.addInput("strings",   strListIn("Strings"));
    this.addInput("delimiter", strIn("Delimiter"));
    this.addOutput("result", strOut("Result"));
  }

  data(inputs: { strings?: string[][]; delimiter?: string[] }): { result: string | null } {
    const strings: string[] = inputs.strings?.[0] ?? [];
    const delimiter = strScalar(inputs.delimiter, this, "delimiter");
    if (delimiter === null) { this.cachedText = null; return { result: null }; }
    const parts     = this.ignoreEmpty === "ignore" ? strings.filter(s => s !== "") : strings;
    const result    = parts.join(delimiter);
    this.cachedText = result;
    return { result };
  }
}

// ─── TEXTSPLIT ────────────────────────────────────────────────────────────────

export class TextSplitNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    delimiter: "An empty delimiter splits the text into single characters.",
  };

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

  data(inputs: { text?: string[]; delimiter?: string[] }): { result: string[] | null } {
    const text      = strScalar(inputs.text,      this, "text");
    const delimiter = strScalar(inputs.delimiter, this, "delimiter");
    if (text === null || delimiter === null) { this.cachedResult = null; return { result: null }; }
    const result    = splitText(text, delimiter);
    this.cachedResult = result;
    return { result };
  }
}

// ─── TEXTAFTER / TEXTBEFORE ───────────────────────────────────────────────────

export const TEXT_AFTER_BEFORE_OP_META = {
  after:  { label: "TEXTAFTER",  description: "Text after the first occurrence of delimiter. Null if not found. Excel: TEXTAFTER." },
  before: { label: "TEXTBEFORE", description: "Text before the first occurrence of delimiter. Null if not found. Excel: TEXTBEFORE." },
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
    this.label = init?.label ?? "";
    this.addInput("text",      strComboIn("Text"));
    this.addInput("delimiter", strComboIn("Delimiter"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: {
    text?: (string | string[])[];
    delimiter?: (string | string[])[];
  }): { result: CellResult<string> } {
    // A blank or absent delimiter is a per-cell blank.
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
    // A first-class logical like Excel EXACT, not 1/0; the logical↔number bridge
    // still lets it reach a plain `number` input.
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

// ─── NUMBERVALUE ─────────────────────────────────────────────────────────────

export class NumberValueNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    decimal_sep: "Defaults to a period.",
    group_sep: "Defaults to a comma.",
  };
  label: string;
  cachedResult: BroadcastResult = null;
  // The separators ship EMPTY so the field shows its default as a placeholder;
  // data() reads empty/unset as the default.
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 195;

  constructor(init?: { label?: string }) {
    super("NumberValue");
    this.label = init?.label ?? "NUMBERVALUE";
    this.addInput("text",        strComboIn("Text"));
    // The separators pick a parsing CONVENTION, not an operand, so they stay scalar.
    this.addInput("decimal_sep", strIn("Decimal sep"));
    this.addInput("group_sep",   strIn("Group sep"));
    this.addOutput("result", numListOut("Number"));
  }

  data(inputs: {
    text?: (string | string[])[];
    decimal_sep?: string[];
    group_sep?: string[];
  }): { result: BroadcastResult } {
    // An empty separator means "use the default"; a WIRED blank is a mode the graph
    // failed to supply, and propagates.
    const decRaw = readInput(inputs.decimal_sep, this.stringLiterals.decimal_sep ?? "");
    const grpRaw = readInput(inputs.group_sep, this.stringLiterals.group_sep ?? "");
    if (decRaw === null || grpRaw === null) { this.cachedResult = null; return { result: null }; }
    const decSep = decRaw || ".";
    const grpSep = grpRaw || ",";
    const result = broadcastCells((raw: string) => {
      const text = raw.trim();
      // Empty is blank; an unparseable non-empty string is #VALUE!, per cell.
      if (!text) return null;
      // NUMBERVALUE order: strip groups, normalize the decimal, drop ALL whitespace,
      // then peel trailing `%` (each ÷100). The parse is STRICT full-string Number(),
      // never parseFloat's greedy prefix, so "12x" is #VALUE!.
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

// ─── ENCODEURL / DECODEURL ────────────────────────────────────────────────────

export const URL_ENCODE_LABEL: Record<UrlEncodeOp, string> = { encode: "ENCODEURL", decode: "DECODEURL", base64: "ENCODEBASE64", unbase64: "DECODEBASE64" };

export class UrlEncodeNode extends ClassicPreset.Node {
  label: string;
  op: UrlEncodeOp;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: UrlEncodeOp }) {
    super("UrlEncode");
    this.op    = init?.op ?? "encode";
    this.label = init?.label ?? "";
    this.addInput("text", strComboIn("Text"));
    this.addOutput("result", strComboOut("Result"));
  }

  data(inputs: { text?: (string | string[])[] }): { result: CellResult<string> } {
    const result = broadcastCells((text: string) => urlEncode(this.op, text), strVal(inputs.text, this, "text"));
    this.cachedText = result;
    return { result };
  }
}

// ─── TEMPLATE ────────────────────────────────────────────────────────────────

/** The node's formatters: numbers through TEXT (General without a spec), a date-typed
 *  input through the date format. */
const TEMPLATE_FORMATTERS: TemplateFormatters = {
  number: (v, spec) => String(resolveExcelFunction("TEXT")!(v, spec ?? "@")),
  date: (v, spec) => formatDateSerial(v, spec ?? DEFAULT_DATE_FORMAT),
};

export class TemplateNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    template: "{name} inserts an input of that name, {name:0.00} formats it with an Excel TEXT code; {{ and }} print braces. Each new name grows a socket.",
    result: "One string, or a list when any placeholder is fed a list (the rest repeat).",
  };
  label: string;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { template: "" };
  /** The placeholder sockets currently grown — PERSISTED so a saved cable finds its socket at load. */
  sideVars: string[] = [];
  width = 240; height = 200;

  constructor(init?: { label?: string; sideVars?: string[] }) {
    super("Template");
    this.label = init?.label ?? "Template";
    this.addInput("template", strIn("Template"));
    if (Array.isArray(init?.sideVars)) {
      this.sideVars = init.sideVars.filter((v) => typeof v === "string");
      for (const v of this.sideVars) this.addInput(v, anyDataIn(v));
    }
    this.addOutput("result", strComboOut("Text"));
  }

  /** Grow/shrink the placeholder sockets to match the template text — driven by data(), so it
   *  reconciles via a microtask; cables on a removed socket drop first (onePrunePath). */
  private _reconcile(needed: string[]): void {
    const added = needed.filter((v) => !this.sideVars.includes(v));
    const removed = this.sideVars.filter((v) => !needed.includes(v));
    if (added.length === 0 && removed.length === 0) return;
    this.sideVars = needed;
    queueMicrotask(() => {
      void (async () => {
        for (const v of added) if (!this.inputs[v]) this.addInput(v, anyDataIn(v));
        await dropInputCables(this.id, removed);
        for (const v of removed) if (this.inputs[v]) this.removeInput(v);
        await getActiveArea()?.update("node", this.id);
      })();
    });
  }

  data(inputs: { template?: string[] } & Record<string, unknown[] | undefined>): { result: CellResult<string> } {
    const template = strScalar(inputs.template, this, "template");
    if (template === null) { this.cachedText = null; return { result: null }; }
    const names = templatePlaceholders(template);
    this._reconcile(names);
    const isDate = (name: string) => {
      const sock = this.inputs[name]?.socket;
      return sock instanceof SolenoidSocket && sock.dataType.startsWith("date");
    };
    const value = (name: string): unknown => (this.sideVars.includes(name) || this.inputs[name] ? inputs[name]?.[0] ?? null : null);
    // A list on any placeholder broadcasts: the result is a list, scalars repeat.
    const lens = names.map((n) => { const v = value(n); return Array.isArray(v) ? v.length : -1; }).filter((l) => l >= 0);
    const render = (at: number | null) => renderTemplate(template, (n) => { const v = value(n); return at !== null && Array.isArray(v) ? v[at] ?? null : v; }, (v, n, spec) => templateFormat(v, spec, TEMPLATE_FORMATTERS, isDate(n)));
    const result: CellResult<string> = lens.length === 0 ? render(null) : Array.from({ length: Math.max(...lens) }, (_, i) => render(i));
    this.cachedText = result;
    return { result };
  }
}

// ─── HASH / UUID ─────────────────────────────────────────────────────────────

export class HashNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Lowercase hex of the UTF-8 text; the same text always hashes the same, so hashed keys still join.",
  };
  label: string;
  op: HashAlgorithm;
  cachedText: CellResult<string> = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 190; height = 170;

  constructor(init?: { label?: string; op?: HashAlgorithm }) {
    super("Hash");
    this.label = init?.label ?? "Hash";
    this.op = init?.op ?? "sha256";
    this.addInput("text", strComboIn("Text"));
    this.addOutput("result", strComboOut("Digest"));
  }

  data(inputs: { text?: (string | string[])[] }): { result: CellResult<string> } {
    const result = broadcastCells((t: string) => hashText(t, this.op), strVal(inputs.text, this, "text"));
    this.cachedText = result;
    return { result };
  }
}

/** A fresh random v4 UUID per recalculation (F9) — a volatile source like RAND. */
export class UuidNode extends ClassicPreset.Node {
  label: string;
  cachedText: string | null = null;
  private lastGen = -1;
  private value = "";
  width = 260; height = 104;

  constructor(init?: { label?: string }) {
    super("Uuid");
    this.label = init?.label ?? "UUID";
    this.addOutput("result", strOut("UUID"));
  }

  data(): { result: string } {
    const gen = getRecalcGen();
    if (this.lastGen !== gen) { this.value = uuidV4(); this.lastGen = gen; }
    this.cachedText = this.value;
    return { result: this.value };
  }
}

// ─── ROMAN / ARABIC ───────────────────────────────────────────────────────────

export type RomanArabicOp = "roman" | "arabic";

export class RomanArabicNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    number: "1 to 3999 — Roman numerals cannot express values outside this range.",
  };
  label: string;
  op: RomanArabicOp;
  cachedResult: CellResult<string | number> = null;
  stringLiterals: Record<string, string> = { text: "" };
  literals: Record<string, number> = { number: 1 };
  width = 180; height = 135;

  constructor(init?: { label?: string; op?: RomanArabicOp }) {
    super("RomanArabic");
    this.op    = init?.op ?? "roman";
    this.label = init?.label ?? "";
    if (this.op === "roman") {
      this.addInput("number", numListIn("Number"));
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
        }, readInput(inputs.number, this.literals.number ?? 1))
      : broadcastCells((raw: string) => {
          const text = raw.toUpperCase().trim();
          // Empty is blank; a non-Roman character is an invalid numeral (#VALUE!).
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
    this.addInput("decimals", numListIn("Decimals"));
    this.addOutput("result", strComboOut("Text"));
  }

  data(inputs: { number?: (number | number[])[]; decimals?: (number | number[])[] }): { result: CellResult<string> } {
    const result = broadcastCells(
      (n: number, d: number) => {
        // Excel truncates the decimals arg toward zero, and a NEGATIVE count rounds left of
        // the point: FIXED(12345.678, -2) = "12,300". Pre-round for that, then format 0 places.
        const dd = Math.trunc(d);
        const rounded = dd < 0 ? Math.round(n * 10 ** dd) / 10 ** dd : n;
        return resolveExcelFunction("FIXED")!(
          rounded, Math.max(0, dd), this.noCommas === "no_commas") as string;
      },
      readInput(inputs.number,   this.literals.number   ?? 0),
      readInput(inputs.decimals, this.literals.decimals ?? 2),
    );
    this.cachedText = result;
    return { result };
  }
}


// ─── REGEX (REGEXTEST / REGEXEXTRACT / REGEXREPLACE) ─────────────────────────

export const REGEX_OP_META: Record<RegexOp, { label: string; description: string }> = {
  test:           { label: "REGEXTEST",           description: "Returns 1 if text matches the pattern, else 0. Wired list input broadcasts element-wise. Excel 365: REGEXTEST." },
  extract:        { label: "REGEXEXTRACT",        description: "Returns the first match found in text, or empty string if none. Wired list input returns a list of first matches. Excel 365: REGEXEXTRACT." },
  extract_all:    { label: "REGEXEXTRACT (all)",    description: "Returns all matches found in a single string as a list. Excel 365: REGEXEXTRACT with return_mode=1." },
  extract_groups: { label: "REGEXEXTRACT (groups)", description: "Returns the first match's capture groups as a list. Excel 365: REGEXEXTRACT with return_mode=2." },
  replace:        { label: "REGEXREPLACE",        description: "Replaces regex matches with the replacement string — all of them, or only the nth when Occurrence is set. Wired list input broadcasts element-wise. Excel 365: REGEXREPLACE." },
};


export class RegexNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    pattern: "Patterns follow JavaScript regular expression syntax. An invalid pattern gives a blank result.",
    replacement: "Only the replace operation reads this input. $1 inserts the first capture group.",
    occurrence: "Only REGEXREPLACE reads this. Blank or 0 replaces every match; n replaces only the nth.",
  };

  label: string;
  op: RegexOp;
  cachedResult: number | number[] | string | string[] | null = null;
  stringLiterals: Record<string, string> = { pattern: "", replacement: "", flags: "" };
  literals: Record<string, number> = { occurrence: 0 };
  width = 180; height = 253;

  constructor(init?: { label?: string; op?: RegexOp }) {
    super("Regex");
    this.op    = init?.op    ?? "test";
    this.label = init?.label ?? "";
    this.addInput("text",        anyListIn("Text"));
    this.addInput("pattern",     strIn("Pattern"));
    this.addInput("replacement", strIn("Replace with"));
    this.addInput("occurrence",  numListIn("Occurrence"));
    this.addOutput("result", anyComboOut("Result"));
  }

  data(inputs: {
    text?: unknown[];
    pattern?: string[];
    replacement?: string[];
    occurrence?: (number | number[])[];
  }): { result: number | number[] | string | string[] | null } {
    const pattern = readInput(inputs.pattern, this.stringLiterals.pattern ?? "");
    // `replacement`/`occurrence` are read by the "replace" op ALONE — guard scoped to the
    // active op (value-semantics.md), so a wired blank must not blank a TEST.
    const replacement = this.op === "replace"
      ? readInput(inputs.replacement, this.stringLiterals.replacement ?? "")
      : "";
    const occurrenceRaw = this.op === "replace"
      ? readInput(inputs.occurrence, this.literals.occurrence ?? 0)
      : 0;
    if (pattern === null || replacement === null || occurrenceRaw === null) { this.cachedResult = null; return { result: null }; }
    const flags       = this.stringLiterals.flags ?? "";
    // occ ≥ 1 replaces only the nth match; 0/blank replaces every match — the same
    // composition the formula's REGEXREPLACE uses (regexApply vs replaceNth).
    const occ = Math.max(0, Math.floor(Number(occurrenceRaw) || 0));

    if (!pattern || !safeRegex(pattern, flags)) { this.cachedResult = null; return { result: null }; }

    // Unwired text keeps the old empty-string reading; a WIRED blank is unknown and
    // propagates. Per-cell missing/error cells ride through untouched — never
    // stringified into "null" / "[object Object]" (value-semantics.md).
    const rawText = inputs.text === undefined ? "" : (inputs.text[0] ?? null);
    const applyCell = (c: unknown): number | string | string[] | SolError | null =>
      c == null ? null
      : isSolError(c) ? c
      : this.op === "replace" && occ >= 1
        ? replaceNth(String(c), pattern, replacement, occ, flags)
        : (regexApply(this.op, String(c), pattern, replacement, flags) as number | string | string[]);

    let result: number | number[] | string | string[] | null;
    if (rawText === null) {
      result = null;
    } else if (this.op === "extract_all" || this.op === "extract_groups") {
      result = applyCell(Array.isArray(rawText) ? (rawText as unknown[])[0] : rawText) as string[];
    } else if (Array.isArray(rawText)) {
      result = (rawText as unknown[]).map(applyCell) as number[] | string[];
    } else {
      result = applyCell(rawText) as number | string;
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
    this.addInput("decimals", numListIn("Decimals"));
    this.addOutput("result", strComboOut("Currency text"));
  }

  data(inputs: { number?: (number | number[])[]; decimals?: (number | number[])[] }): { result: CellResult<string> } {
    const result = broadcastCells((n: number, d: number) => {
      // Like FIXED: truncate the decimals arg toward zero; a negative count rounds left of the
      // point — DOLLAR(12345.678, -2) = "$12,300".
      const dd = Math.trunc(d);
      const mag = dd < 0 ? Math.round(Math.abs(n) * 10 ** dd) / 10 ** dd : Math.abs(n);
      const rounded = mag.toFixed(Math.max(0, dd));
      const parts = rounded.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return (n < 0 ? "-$" : "$") + parts.join(".");
    },
      readInput(inputs.number,   this.literals.number   ?? 0),
      readInput(inputs.decimals, this.literals.decimals ?? 2));
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
      (t: string) => reverseText(t),
      strVal(inputs.text, this, "text"),
    );
    this.cachedText = result;
    return { result };
  }
}

// ─── Spell Number (Timesavers pack) ───────────────────────────────────────────
// Number → English words: cardinals to the trillions, decimals digit-by-digit,
// negatives prefixed. The kernel lives in textOps.ts so the SPELLNUMBER registration
// never loads rete.
export { spellNumber } from "./textOps";
import { spellNumber, ordinalText, textSimilarity, fuzzyBest, type SimilarityMethod } from "./textOps";
export type { SimilarityMethod } from "./textOps";


export class SpellNumberNode extends ClassicPreset.Node {
  label: string;
  /** Spell out in words (forty-two) or as an ordinal (42nd). */
  mode: "words" | "ordinal" = "words";
  cachedText: CellResult<string> = null;
  literals: Record<string, number> = { value: 0 };
  width = 210; height = 165;

  constructor(init?: { label?: string; mode?: "words" | "ordinal" }) {
    super("SpellNumber");
    this.label = init?.label ?? "Spell Number";
    if (init?.mode) this.mode = init.mode;
    this.addInput("value", numListIn("Number"));
    this.addOutput("result", strComboOut(this.mode === "ordinal" ? "Ordinal" : "Words"));
  }

  setMode(next: "words" | "ordinal"): void {
    this.mode = next;
    const out = this.outputs.result;
    if (out) out.label = next === "ordinal" ? "Ordinal" : "Words";
  }

  data(inputs: { value?: (number | number[] | null)[] }): { result: CellResult<string> } {
    // A CONNECTED cable wins even carrying null; only an unwired slot falls back.
    const value = inputs.value === undefined || inputs.value.length === 0
      ? this.literals.value
      : inputs.value[0] ?? null;
    const result = broadcastCells((v: number) => (this.mode === "ordinal" ? ordinalText(v) : spellNumber(v)), value);
    this.cachedText = result;
    return { result };
  }
}

// ─── TEXT SIMILARITY / FUZZY MATCH (rapidfuzz, stringdist, Excel's Fuzzy Lookup add-in) ──
export const SIMILARITY_METHOD_META = {
  ratio:        { label: "Ratio (Levenshtein)", description: "1 − edit distance ÷ longer length: 0 = nothing shared, 1 = identical. rapidfuzz ratio, R stringsim." },
  damerau:      { label: "Ratio (Damerau)",     description: "The same ratio counting an adjacent swap (teh → the) as one edit." },
  jaro_winkler: { label: "Jaro–Winkler",        description: "0–1 similarity that rewards a shared prefix — the record-linkage standard for names." },
  levenshtein:  { label: "Edit distance",       description: "The raw Levenshtein distance: how many inserts, deletes or substitutions turn one into the other." },
} satisfies Record<SimilarityMethod, { label: string; description: string }>;

export class TextSimilarityNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Case-sensitive. Run both sides through LOWER / Clean Whitespace first when case and spacing shouldn't count.",
  };
  label: string;
  method: SimilarityMethod = "ratio";
  cachedResult: BroadcastResult = null;
  stringLiterals: Record<string, string> = { a: "", b: "" };
  width = 190; height = 200;

  constructor(init?: { label?: string; method?: SimilarityMethod }) {
    super("TextSimilarity");
    this.label = init?.label ?? "Text Similarity";
    if (init?.method) this.method = init.method;
    this.addInput("a", strComboIn("Text 1"));
    this.addInput("b", strComboIn("Text 2"));
    this.addOutput("result", numListOut("Similarity"));
  }

  data(inputs: { a?: (string | string[])[]; b?: (string | string[])[] }): { result: BroadcastResult } {
    const result = broadcastCells((a: string, b: string) => textSimilarity(a, b, this.method), strVal(inputs.a, this, "a"), strVal(inputs.b, this, "b"));
    this.cachedResult = result as BroadcastResult;
    return { result: this.cachedResult };
  }
}

export class FuzzyMatchNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    threshold: "0–1. A needle whose best candidate scores below it answers #N/A instead of a bad guess; 0 always picks the closest.",
    match: "The closest candidate per needle (first on ties) — feed it to XLOOKUP for an exact join.",
    score: "That candidate's similarity, 0–1.",
  };
  label: string;
  method: SimilarityMethod = "ratio";
  literals: Record<string, number> = { threshold: 0.6 };
  stringLiterals: Record<string, string> = { needle: "" };
  cachedMatch: CellResult<string> = null;
  cachedScore: BroadcastResult = null;
  width = 200; height = 225;

  constructor(init?: { label?: string; method?: SimilarityMethod }) {
    super("FuzzyMatch");
    this.label = init?.label ?? "Fuzzy Match";
    if (init?.method) this.method = init.method;
    this.addInput("needle", strComboIn("Text"));
    this.addInput("candidates", strListIn("Candidates"));
    this.addInput("threshold", numIn("Threshold"));
    this.addOutput("match", strComboOut("Best match"));
    this.addOutput("score", numListOut("Score"));
  }

  data(inputs: { needle?: (string | string[])[]; candidates?: (string | null)[][]; threshold?: number[] }): { match: CellResult<string>; score: BroadcastResult } {
    const needle = strVal(inputs.needle, this, "needle");
    const cands = (inputs.candidates?.[0] ?? []).filter((v): v is string => typeof v === "string");
    const threshold = readInput(inputs.threshold, this.literals.threshold ?? 0.6);
    if (needle === null || threshold === null) { this.cachedMatch = null; this.cachedScore = null; return { match: null, score: null }; }
    const pick = (n: string) => fuzzyBest(n, cands, this.method, threshold);
    const na = () => solError("#N/A", "No candidate is similar enough");
    const one = (n: string) => { const b = pick(n); return b ? b.text : na(); };
    const sc = (n: string) => { const b = pick(n); return b ? b.score : na(); };
    const match = Array.isArray(needle) ? needle.map(one) : one(needle);
    const score = Array.isArray(needle) ? needle.map(sc) : sc(needle);
    this.cachedMatch = match as CellResult<string>;
    this.cachedScore = score as BroadcastResult;
    return { match: this.cachedMatch, score: this.cachedScore };
  }
}
