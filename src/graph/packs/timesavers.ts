// Conveniences that are not single Excel functions: reclassified core nodes, the shared
// HYPOTENUSE claim, formula presets, and nodes with no Excel answer at all.

import { HYPOTENUSE_ENTRY } from "./geometry";
import { ReverseTextNode, SpellNumberNode } from "../rete-nodes";
import { placeFormulas, type Pack, type FormulaPackEntry } from "./packShared";

export const TIMESAVER_NUMERIC: FormulaPackEntry[] = [
  { type: "ts-percent-change", label: "Percent Change", expr: "(after-before)/before",
    description: "Relative change from before to after, as a fraction. Format as % with an FC. Excel: (B2-A2)/A2.",
    keywords: "delta growth relative difference" },
  { type: "ts-cagr", label: "Growth Rate (CAGR)", expr: "(endval/startval)^(1/periods)-1",
    description: "Compound growth rate per period from start/end values over a number of periods   (=(end/start)^(1/n)-1)",
    excel: [{ excel: "RRI", syntax: "=RRI(nper, pv, fv)" }],
    keywords: "compound annual growth" },
];

export const TIMESAVER_TEXT: FormulaPackEntry[] = [
  { type: "ts-ordinal", label: "Ordinal Suffix", expr: "ORDINAL(n)", resultAs: "text",
    description: "1 → 1st, 23 → 23rd, handling the 11th/12th/13th case. No single Excel function; the usual formula nests CHOOSE and MOD.",
    keywords: "st nd rd th rank suffix" },
  { type: "ts-clean-whitespace", label: "Clean Whitespace", expr: "TRIM(CLEAN(SUBSTITUTE(t,CHAR(160),\" \")))", resultAs: "text",
    description: "TRIM, CLEAN, and strip non-breaking spaces (CHAR(160)) in one step: the web and PDF paste fixer.",
    keywords: "trim clean nbsp paste sanitize" },
  { type: "ts-mask-last", label: "Mask (Show Last N)", expr: "REPT(\"*\",MAX(LEN(t)-k,0))&RIGHT(t,MIN(k,LEN(t)))", resultAs: "text",
    description: "Redact all but the last k characters: ****1234   (=REPT(\"*\",LEN(A1)-4)&RIGHT(A1,4))",
    keywords: "redact stars hide card ssn" },
  { type: "ts-count-words", label: "Count Words", expr: "IF(LEN(TRIM(t))=0,0,LEN(TRIM(t))-LEN(SUBSTITUTE(TRIM(t),\" \",\"\"))+1)",
    description: "Number of space-separated words. The LEN−SUBSTITUTE idiom, empty-safe.",
    keywords: "word count" },
  { type: "ts-count-occurrences", label: "Count Occurrences", expr: "(LEN(t)-LEN(SUBSTITUTE(t,sub,\"\")))/LEN(sub)",
    description: "How many times substring sub appears in t (case-sensitive)   (=(LEN(A1)-LEN(SUBSTITUTE(A1,\"x\",\"\")))/LEN(\"x\"))",
    keywords: "substring count find occurrences" },
];

export const TIMESAVER_DATE: FormulaPackEntry[] = [
  { type: "ts-quarter", label: "Quarter", expr: "ROUNDUP((MOD(MONTH(date)-start,12)+1)/3,0)",
    literals: { start: 1 },
    varDescriptions: { start: "First month of the fiscal year: 1 = January (plain calendar quarters). Set 4 for an April fiscal year, 7 for July, and so on." },
    description: "Quarter 1–4 of a date. Calendar by default; set the start month to your fiscal year's first month (1 = January) for fiscal quarters. No single Excel function.",
    keywords: "q1 q2 q3 q4 fiscal calendar period three months start" },
  { type: "ts-days-in-month", label: "Days in Month", expr: "DAY(EOMONTH(date,0))",
    description: "How many days are in a date's month, 28–31. Excel: DAY(EOMONTH(date, 0)).",
    keywords: "month length last day eomonth 28 29 30 31" },
  { type: "ts-age", label: "Age", resultAs: "text",
    expr: "DATEDIF(dob,TODAY(),\"Y\")&\"y \"&DATEDIF(dob,TODAY(),\"YM\")&\"m \"&DATEDIF(dob,TODAY(),\"MD\")&\"d\"",
    varDescriptions: { dob: "The birth date (or any start date). Age is measured to today." },
    description: "Age from a date to today, as \"34y 2m 5d\". Built on DATEDIF. The days part uses DATEDIF's \"MD\", which Excel itself computes unreliably when a whole month is skipped, the classic 31 Jan → 1 Mar. Solenoid borrows from the month before the end date for a consistent, repeatable result, so that edge case can read differently from Excel.",
    keywords: "birthday dob datedif years months days duration elapsed how old" },
  { type: "ts-nth-weekday", label: "Nth Weekday", resultAs: "date",
    expr: "DATE(YEAR(date),MONTH(date),1+MOD(weekday-WEEKDAY(DATE(YEAR(date),MONTH(date),1))+7,7)+(n-1)*7)",
    literals: { n: 2, weekday: 3 },
    varDescriptions: {
      n: "Which occurrence: 1 = first, 2 = second, … A 5th rolls into the next month when the month has only four.",
      weekday: "Day of the week, Excel WEEKDAY numbering: 1 = Sunday, 2 = Monday … 7 = Saturday.",
    },
    description: "The date of the Nth weekday of a month. The default is the 2nd Tuesday. Give any date in the target month, then pick the occurrence and the weekday. No single Excel function.",
    keywords: "nth first second third fourth tuesday monday meeting recurring day of week payday" },
];

export const TIMESAVER_FORMULAS: FormulaPackEntry[] = [
  ...TIMESAVER_NUMERIC, ...TIMESAVER_TEXT, ...TIMESAVER_DATE,
];

export const TIMESAVERS_PACK: Pack = {
  id: "timesavers",
  group: "Everyday",
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
        description: "Reverses a string. No Excel formula does it; VBA's StrReverse is the workaround.",
        keywords: "backwards mirror strreverse",
        create: () => new ReverseTextNode(),
      },
    },
    {
      path: ["Text", "Transform"],
      entry: {
        type: "ts-spell-number",
        label: "Spell Number",
        description: "Number → English words (\"one hundred twenty-three\", up to the trillions) or ordinal (\"123rd\"). Pick on the node. Excel: none; the words need a VBA macro.",
        keywords: "words written amount cheque check ordinal 1st 2nd 3rd nth suffix rank position",
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
    "url-decode",
    "logic-xnor", "logic-nand", "logic-nor",
  ],
};
