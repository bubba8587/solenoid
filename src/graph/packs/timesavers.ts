// Conveniences that are not single Excel functions: reclassified core nodes, the shared
// HYPOTENUSE claim, formula presets, and nodes with no Excel answer at all.

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
    description: "1 → 1st, 23 → 23rd (with the 11th/12th/13th special case) — no Excel function. The usual formula is a CHOOSE and MOD monster",
    keywords: "st nd rd th rank suffix" },
  { type: "ts-clean-whitespace", label: "Clean Whitespace", expr: "TRIM(CLEAN(SUBSTITUTE(t,CHAR(160),\" \")))", resultAs: "text",
    description: "TRIM + CLEAN + strip non-breaking spaces (CHAR(160)) — the web or PDF-paste fixer Excel needs three functions for",
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

export const TIMESAVER_DATE: FormulaPackEntry[] = [
  { type: "ts-quarter", label: "Quarter", expr: "ROUNDUP(MONTH(date)/3,0)",
    description: "Calendar quarter 1–4 of a date. No single Excel function — the usual formula is ROUNDUP(MONTH()/3,0).",
    keywords: "q1 q2 q3 q4 fiscal period three months" },
  { type: "ts-days-in-month", label: "Days in Month", expr: "DAY(EOMONTH(date,0))",
    description: "How many days are in a date's month, 28–31. Excel spells it DAY(EOMONTH(date,0)).",
    keywords: "month length last day eomonth 28 29 30 31" },
];

export const TIMESAVER_FORMULAS: FormulaPackEntry[] = [
  ...TIMESAVER_NUMERIC, ...TIMESAVER_TEXT, ...TIMESAVER_DATE,
];

export const TIMESAVERS_PACK: Pack = {
  id: "timesavers",
  name: "Common Excel Timesavers",
  description: "Solenoid conveniences that aren't single Excel functions (rolling aggregates, weighted stats, list utilities, extended logic, percent change and CAGR, text cleanup, Reverse Text, Spell Number…). On by default. Turn off to declutter.",
  builtin: true,
  defaultActive: true,
  nodes: [
    { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
    ...placeFormulas(["Numbers", "Arithmetic"], TIMESAVER_NUMERIC),
    ...placeFormulas(["Text", "Transform"], TIMESAVER_TEXT),
    ...placeFormulas(["Date & Time"], TIMESAVER_DATE),
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
  // Reclassifies EXISTING core nodes; the pack ships ON, so nothing disappears by default.
  // Fundamental list ops (Range, LinSpace, Reverse, Slice, Length) stay core deliberately.
  tags: [
    "weighted-wavg", "weighted-wstdev", "weighted-wvar",
    "arg-argmax", "arg-argmin",
    "list-contains", "list-diff", "list-normalize",
    "list-shuffle", "list-interleave", "list-nthelement",
    "list-geometric", "list-fibonacci", "list-repeat",
    "text-filter",
    "url-decode",
    "logic-xnor", "logic-nand", "logic-nor",
  ],
};
