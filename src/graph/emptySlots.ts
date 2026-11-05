// [[C80]] blankArgIsExcelBlank, [[D96]] emptySlotShowsItsValue
import { argRole, LEFT_OUT, type InputRole } from "./inputRoles";
import { FORMULA_SIGNATURES } from "./formulaSignatureTable";
import { coreEmptyField } from "./engineWasm";

interface PackSlotMeta { signature?: string; emptySlotsLeftOut?: boolean; emptySlotShown?: string }
// Pack functions, handed in by formulaSignatures.ts: importing the packs here would close a cycle.
let packMeta: (name: string) => PackSlotMeta | undefined = () => undefined;
export function setPackLookup(lookup: (name: string) => PackSlotMeta | undefined): void {
  packMeta = lookup;
}

/** What an empty argument slot reads as, and the placeholder it shows (null when its reading is ""). */
export interface EmptySlotReading {
  value: unknown;
  shown: string | null;
}

// Parameter names, as FORMULA_SIGNATURES spells them, whose Excel blank is "" or FALSE; every other parameter's is 0.
const TEXT_PARAMS = new Set([
  "text", "delimiter", "find_text", "within", "old", "new", "pattern", "replacement", "separator", "suffix", "ellipsis",
  "fill", "decimal_sep", "group_sep", "col_delimiter", "row_delimiter", "format", "from_unit", "to_unit", "from_zone",
  "to_zone", "roman_text", "unit", "criteria", "method", "algorithm", "model", "operation", "family", "side", "flags",
  "component", "string",
]);
const LOGICAL_PARAMS = new Set([
  "cumulative", "logical", "ignore_empty", "by_col", "scan_by_column", "descending", "whole_number", "exactly_once",
  "no_commas", "no_switch", "const",
]);

/** Where Excel reads an empty slot apart from its parameter's type and its role (checked in Excel, 2026-10-05). */
const EXCEL_EMPTY_SLOT: Record<string, Record<number, unknown>> = {
  TEXTJOIN: { 1: true },
  XLOOKUP: { 3: LEFT_OUT },
};

/** Where the function's card falls back to a value other than Excel's empty one, so the formula reads the card's
 *  ([[D96]] emptySlotShowsItsValue): a value Excel's 0 would make an error. The core's call table (`blanks` in
 *  `data/call_traits.json`) holds the same. */
const CARD_FALLBACK_SLOT: Record<string, Record<number, unknown>> = {
  "CONFIDENCE.NORM": { 0: 0.05, 1: 1, 2: 30 }, "CONFIDENCE.T": { 0: 0.05, 1: 1, 2: 30 }, SLN: { 2: 1 }, SYD: { 2: 1, 3: 1 },
  DURATION: { 4: 2 }, MDURATION: { 4: 2 }, STANDARDIZE: { 2: 1 }, "CHISQ.DIST.RT": { 1: 10 }, "T.DIST.2T": { 1: 10 },
  "T.DIST.RT": { 1: 10 }, "F.DIST.RT": { 1: 5, 2: 10 },
};

/** Excel's reading for this empty slot when it isn't the parameter's usual one, or the function's card's Fallback. */
function emptySlotOverride(name: string, i: number): { value: unknown } | null {
  const up = name.toUpperCase();
  const card = CARD_FALLBACK_SLOT[up];
  if (card && i in card) return { value: card[i] };
  const fn = EXCEL_EMPTY_SLOT[up];
  return fn && i in fn ? { value: fn[i] } : null;
}

/** A function whose parameter names mislead, by zero-based argument. */
const OVERRIDES: Record<string, Record<number, "number" | "text" | "logical">> = {};

// The word a left-out slot shows for the default it stands for, by parameter name, then by function where a name is ambiguous.
const LEFT_OUT_BY_PARAM: Record<string, string> = {
  basis: "0", type: "0", guess: "0.1", start: "1", step: "1", order: "1", sort_order: "1", sort_index: "1",
  instance_num: "1", by_col: "FALSE", scan_by_column: "FALSE", exactly_once: "FALSE", whole_number: "FALSE",
  no_commas: "FALSE", const: "TRUE", if_not_found: "none", if_empty: "none", pad_with: "#N/A", holidays: "none",
  weekend: "1", significance: "3", places: "auto", factor: "2", base: "10", ignore: "0", mode: "0", columns: "1",
  rows: "1", case_sensitivity: "0",
};
const LEFT_OUT_BY_FN: Record<string, Record<number, string>> = {
  TAKE: { 1: "all", 2: "all" }, DROP: { 1: "none", 2: "none" }, EXPAND: { 1: "same", 2: "same" },
  RANK: { 2: "0" }, "RANK.EQ": { 2: "0" }, "RANK.AVG": { 2: "0" }, TRUNC: { 1: "0" }, DOLLAR: { 1: "2" },
  RANDARRAY: { 2: "0", 3: "1" }, "CEILING.MATH": { 1: "1", 2: "0" }, "FLOOR.MATH": { 1: "1", 2: "0" }, GESTEP: { 1: "0" }, TEXTSPLIT: { 1: "none", 2: "none" }, INTERPOLATE: { 1: "1, 2, 3…", 2: "1, 2, 3…" }, LEFT: { 1: "1" }, RIGHT: { 1: "1" }, WEEKDAY: { 1: "1" }, WEEKNUM: { 1: "1" },
};

function baseName(param: string): string {
  return param.replace(/[[\]…]/g, "").trim().replace(/\d+$/, "");
}

/** The parameter's signature name, bare: a variadic tail repeats the parameter before the ellipsis. */
function paramName(name: string, i: number): string | null {
  const sig = FORMULA_SIGNATURES[name] ?? packMeta(name)?.signature;
  if (!sig) return null;
  const params = sig.split(", ");
  const dots = params.findIndex((p) => p.trim() === "…");
  const p = i < params.length && (dots < 0 || i < dots)
    ? params[i]
    : params[dots > 0 ? dots - 1 : params.length - 1];
  return baseName(p);
}

function paramType(name: string, i: number): "number" | "text" | "logical" {
  const override = OVERRIDES[name]?.[i];
  if (override) return override;
  const base = paramName(name, i);
  if (base === null) return "number";
  if (TEXT_PARAMS.has(base)) return "text";
  if (LOGICAL_PARAMS.has(base)) return "logical";
  return "number";
}

/** A left-out default's word as it shows: a value as itself (a Fallback), anything else in brackets (a Behavior), since
 *  it names what happens rather than a value. */
const VALUE_WORD = /^(-?\d[\d.]*(e-?\d+)?|TRUE|FALSE|#N\/A|1, 2, 3…)$/;
const behavior = (word: string): string => (VALUE_WORD.test(word) ? word : `[${word}]`);

const show = (v: unknown): string | null =>
  v === "" || v === null ? null : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);

/** An empty slot at argument `i` of `name` reads as Excel's blank for that parameter ([[C80]] blankArgIsExcelBlank). */
export function emptySlotReading(name: string, i: number): EmptySlotReading {
  const up = name.toUpperCase();
  const override = emptySlotOverride(up, i);
  if (override) {
    if (override.value !== LEFT_OUT) return { value: override.value, shown: show(override.value) };
    const param = paramName(up, i);
    return { value: LEFT_OUT, shown: behavior(LEFT_OUT_BY_FN[up]?.[i] ?? (param ? LEFT_OUT_BY_PARAM[param] : undefined) ?? "default") };
  }
  const role = argRole(up, i);
  if (role?.kind === "setting") {
    if (role.blank !== LEFT_OUT) return { value: role.blank, shown: show(role.blank) };
    const param = paramName(up, i);
    return { value: LEFT_OUT, shown: behavior(LEFT_OUT_BY_FN[up]?.[i] ?? (param ? LEFT_OUT_BY_PARAM[param] : undefined) ?? "default") };
  }
  if (role?.kind === "picks") return { value: LEFT_OUT, shown: role.required ? null : behavior("all") };
  if (role?.kind === "required") return { value: null, shown: null };
  const pack = packMeta(up);
  if (pack?.emptySlotsLeftOut) return { value: LEFT_OUT, shown: behavior(pack.emptySlotShown ?? "solve") };
  const type = paramType(up, i);
  const value = type === "text" ? "" : type === "logical" ? false : 0;
  return { value, shown: show(value) };
}

/** What a card's empty field shows, and which kind it is ([[D96]] emptySlotShowsItsValue): the core's declaration,
 *  else a setting's role (its blank a Fallback, left out a Behavior). `undefined` where the field declares nothing. */
export interface EmptyFieldShown {
  kind: "fallback" | "behavior" | "example" | "required";
  shown: string | undefined;
}

export function emptyFieldShown(cardClass: string, key: string, role: InputRole | undefined, op = ""): EmptyFieldShown | undefined {
  const declared = coreEmptyField(cardClass, op, key);
  if (declared) return { kind: declared.kind, shown: declared.shown ?? undefined };
  if (role?.kind === "required") return { kind: "required", shown: undefined };
  if (role?.kind !== "setting") return undefined;
  if (role.from) {
    const r = emptySlotReading(role.from[0], role.from[1]);
    return { kind: r.value === LEFT_OUT && !VALUE_WORD.test(r.shown ?? "") ? "behavior" : "fallback", shown: r.shown ?? undefined };
  }
  if (role.blank !== LEFT_OUT) return { kind: "fallback", shown: show(role.blank) ?? undefined };
  const word = behavior(role.word ?? LEFT_OUT_BY_PARAM[key] ?? "default");
  return { kind: VALUE_WORD.test(word) ? "fallback" : "behavior", shown: word };
}
