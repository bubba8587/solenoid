// Common Excel Timesavers — Solenoid conveniences that aren't single Excel
// functions. Three layers: a reclassification of existing core nodes (`tags`),
// the cross-domain HYPOTENUSE claim, and — first landed 2026-07-09, from
// docs/archive/timesavers-pack-proposal.md — a formula-preset batch (the [F]
// idioms: percent change, CAGR, ordinal, whitespace cleanup, masking, counting)
// plus the two marquee custom nodes with NO Excel answer at all (Reverse Text,
// Spell Number). The proposal's date-serial idioms stay unbuilt pending the
// Formula.js serial-interop check; its composites are in the composite plan doc.

import { HYPOTENUSE_ENTRY } from "./geometry";
import { ReverseTextNode, SpellNumberNode } from "../rete-nodes";
import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";

export const TIMESAVER_NUMERIC: FormulaPackEntry[] = [
  { type: "ts-percent-change", label: "Percent Change", expr: "(after-before)/before",
    description: "Relative change from before to after, as a fraction — format as % with an FC   (in Excel: =(B2-A2)/A2)",
    keywords: "delta growth relative difference" },
  { type: "ts-cagr", label: "Growth Rate (CAGR)", expr: "(endval/startval)^(1/periods)-1",
    description: "Compound growth rate per period from start/end values over a number of periods   (=(end/start)^(1/n)-1)",
    excel: [{ excel: "RRI", syntax: "=RRI(nper, pv, fv)" }],
    keywords: "compound annual growth" },
];

export const TIMESAVER_TEXT: FormulaPackEntry[] = [
  { type: "ts-ordinal", label: "Ordinal Suffix", expr: "ORDINAL(n)", resultAs: "text",
    description: "1 → 1st, 23 → 23rd (with the 11th/12th/13th special case) — no Excel function; the usual formula is a CHOOSE/MOD monster",
    keywords: "st nd rd th rank suffix" },
  { type: "ts-clean-whitespace", label: "Clean Whitespace", expr: "TRIM(CLEAN(SUBSTITUTE(t,CHAR(160),\" \")))", resultAs: "text",
    description: "TRIM + CLEAN + strip non-breaking spaces (CHAR(160)) — the web/PDF-paste fixer Excel needs three functions for",
    keywords: "trim clean nbsp paste sanitize" },
  { type: "ts-mask-last", label: "Mask (Show Last N)", expr: "REPT(\"*\",MAX(LEN(t)-k,0))&RIGHT(t,MIN(k,LEN(t)))", resultAs: "text",
    description: "Redact all but the last k characters: ****1234   (=REPT(\"*\",LEN(A1)-4)&RIGHT(A1,4))",
    keywords: "redact stars hide card ssn" },
  { type: "ts-count-words", label: "Count Words", expr: "IF(LEN(TRIM(t))=0,0,LEN(TRIM(t))-LEN(SUBSTITUTE(TRIM(t),\" \",\"\"))+1)",
    description: "Number of space-separated words   (the LEN−SUBSTITUTE idiom, empty-safe)",
    keywords: "word count" },
  { type: "ts-count-occurrences", label: "Count Occurrences", expr: "(LEN(t)-LEN(SUBSTITUTE(t,sub,\"\")))/LEN(sub)",
    description: "How many times substring sub appears in t (case-sensitive)   (=(LEN(A1)-LEN(SUBSTITUTE(A1,\"x\",\"\")))/LEN(\"x\"))",
    keywords: "substring count find occurrences" },
];

export const TIMESAVER_FORMULAS: FormulaPackEntry[] = [
  ...TIMESAVER_NUMERIC, ...TIMESAVER_TEXT,
];

export const TIMESAVERS_PACK: Pack = {
  id: "timesavers",
  name: "Common Excel Timesavers",
  description: "Solenoid conveniences that aren't single Excel functions (rolling aggregates, weighted stats, list utilities, extended logic, percent change/CAGR, text cleanup, Reverse Text, Spell Number…). On by default; turn off to declutter.",
  builtin: true,
  defaultActive: true,
  nodes: [
    { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
    ...placeFormulas(["Numbers", "Arithmetic"], TIMESAVER_NUMERIC),
    ...placeFormulas(["Text", "Transform"], TIMESAVER_TEXT),
    {
      path: ["Text", "Transform"],
      entry: {
        type: "ts-reverse-text",
        label: "Reverse Text",
        description: "Reverses a string — famously impossible in an Excel formula (the VBA StrReverse workaround)",
        keywords: "backwards mirror strreverse",
        create: () => new ReverseTextNode(),
      },
    },
    {
      path: ["Text", "Transform"],
      entry: {
        type: "ts-spell-number",
        label: "Spell Number",
        description: "Number → English words (\"one hundred twenty-three\"), up to the trillions, decimals read digit-by-digit — Excel's answer is a VBA macro",
        keywords: "words written amount cheque check",
        create: () => new SpellNumberNode(),
      },
    },
  ],
  // Reclassification of EXISTING core catalog nodes into this pack. Because
  // Timesavers ships on, nothing disappears by default.
  //
  // Best-effort first pass (auto-derived: not core primitives, not Excel
  // matchers). Fundamental list ops (Range, LinSpace, Reverse, Slice, Length)
  // are intentionally left as core. Refine freely.
  tags: [
    // Rolling window aggregates — Excel does these by hand with OFFSET/ranges.
    "rolling-sum", "rolling-avg", "rolling-min",
    "rolling-max", "rolling-stdev", "rolling-median",
    // Weighted statistics — no single Excel function.
    "weighted-wavg", "weighted-wstdev", "weighted-wvar",
    // Position-of-extreme — Excel uses INDEX/MATCH.
    "arg-argmax", "arg-argmin",
    // List utilities with no direct Excel equivalent.
    "list-contains", "list-diff", "list-normalize",
    "list-shuffle", "list-interleave", "list-nthelement",
    "list-geometric", "list-fibonacci", "list-repeat",
    // List-wise text transforms (Solenoid extras).
    "text-map", "text-filter",
    // Excel ships ENCODEURL but not a decoder.
    "url-decode",
    // Extended boolean logic (Excel has AND/OR/NOT/XOR, not these).
    "logic-xnor", "logic-nand", "logic-nor",
  ],
};
