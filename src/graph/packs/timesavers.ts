// [[B15]] leanCore, [[C79]] packActivationIsPresentation, [[composite-nodes#Packs]]

import { HYPOTENUSE_ENTRY } from "./geometry";
import { ReverseTextNode, SpellNumberNode, TimeZoneConvertNode, WorldClockNode, QrCodeNode } from "../nodeClasses";
import { placeFormulas, formulaNode, type Pack, type FormulaPackEntry } from "./packShared";

const TIMESAVER_NUMERIC: FormulaPackEntry[] = [
  { type: "ts-percent-change", label: "Percent Change", expr: "(after-before)/before",
    varDescriptions: { before: "Starting value", after: "Ending value" },
    description: "Relative change from before to after, as a fraction. Format as % with an FC. Excel: (B2-A2)/A2.",
    keywords: "delta growth relative difference" },
  { type: "ts-cagr", label: "Growth Rate (CAGR)", expr: "(endval/startval)^(1/periods)-1",
    varDescriptions: { startval: "Starting value", endval: "Ending value", periods: "Number of periods" },
    description: "Compound growth rate per period from start/end values over a number of periods   (=(end/start)^(1/n)-1)",
    excel: [{ excel: "RRI", syntax: "=RRI(nper, pv, fv)" }],
    keywords: "compound annual growth" },
];

const TIMESAVER_TEXT: FormulaPackEntry[] = [
  { type: "ts-ordinal", label: "Ordinal Suffix", expr: "ORDINAL(n)",
    varDescriptions: { n: "Number" },
    description: "1 → 1st, 23 → 23rd, handling the 11th/12th/13th case. No single Excel function; the usual formula nests CHOOSE and MOD.",
    keywords: "st nd rd th rank suffix" },
  { type: "ts-clean-whitespace", label: "Clean Whitespace", expr: "TRIM(CLEAN(SUBSTITUTE(t,CHAR(160),\" \")))",
    varDescriptions: { t: "Text" },
    description: "TRIM, CLEAN, and strip non-breaking spaces (CHAR(160)) in one step: the web and PDF paste fixer.",
    keywords: "trim clean nbsp paste sanitize" },
  { type: "ts-mask-last", label: "Mask (Show Last N)", expr: "REPT(\"*\",MAX(LEN(t)-k,0))&RIGHT(t,MIN(k,LEN(t)))",
    varDescriptions: { t: "Text", k: "Visible characters" },
    description: "Redact all but the last k characters: ****1234   (=REPT(\"*\",LEN(A1)-4)&RIGHT(A1,4))",
    keywords: "redact stars hide card ssn" },
  { type: "ts-count-words", label: "Count Words", expr: "IF(LEN(TRIM(t))=0,0,LEN(TRIM(t))-LEN(SUBSTITUTE(TRIM(t),\" \",\"\"))+1)",
    varDescriptions: { t: "Text" },
    description: "Number of space-separated words. The LEN−SUBSTITUTE idiom, empty-safe.",
    keywords: "word count" },
  { type: "ts-count-occurrences", label: "Count Occurrences", expr: "(LEN(t)-LEN(SUBSTITUTE(t,sub,\"\")))/LEN(sub)",
    varDescriptions: { t: "Text", sub: "Substring" },
    description: "How many times substring sub appears in t (case-sensitive)   (=(LEN(A1)-LEN(SUBSTITUTE(A1,\"x\",\"\")))/LEN(\"x\"))",
    keywords: "substring count find occurrences" },
];

/** The Date & Time folder each date timesaver joins, beside the core functions it builds on. */
const DATE_FOLDER: Record<string, string> = {
  "ts-quarter": "Parts", "ts-days-in-month": "Parts", "ts-age": "Difference", "ts-nth-weekday": "Shift & Round",
};

const TIMESAVER_DATE: FormulaPackEntry[] = [
  { type: "ts-quarter", label: "Quarter", expr: "ROUNDUP((MOD(MONTH(date)-start,12)+1)/3,0)",
    literals: { start: 1 },
    varDescriptions: { date: "Date", start: "Fiscal year start month" },
    description: "Quarter 1–4 of a date. Calendar by default; set the start month to your fiscal year's first month (1 = January) for fiscal quarters. No single Excel function.",
    keywords: "q1 q2 q3 q4 fiscal calendar period three months start" },
  { type: "ts-days-in-month", label: "Days in Month", expr: "DAY(EOMONTH(date,0))",
    varDescriptions: { date: "Date" },
    description: "How many days are in a date's month, 28–31. Excel: DAY(EOMONTH(date, 0)).",
    keywords: "month length last day eomonth 28 29 30 31" },
  { type: "ts-age", label: "Age",
    expr: "DATEDIF(dob,TODAY(),\"Y\")&\"y \"&DATEDIF(dob,TODAY(),\"YM\")&\"m \"&DATEDIF(dob,TODAY(),\"MD\")&\"d\"",
    varDescriptions: { dob: "Birth date" },
    description: "Age to today as \"34y 2m 5d\" via DATEDIF. The days (\"MD\") borrow from the month before the end date, so month-end cases can differ from Excel.",
    keywords: "birthday dob datedif years months days duration elapsed how old" },
  { type: "ts-nth-weekday", label: "Nth Weekday",
    expr: "DATE(YEAR(date),MONTH(date),1+MOD(weekday-WEEKDAY(DATE(YEAR(date),MONTH(date),1))+7,7)+(n-1)*7)",
    literals: { n: 2, weekday: 3 },
    varDescriptions: {
      date: "Date",
      n: "Occurrence",
      weekday: "Weekday",
    },
    description: "The Nth weekday of a month, default the 2nd Tuesday: any date in the month, then the occurrence and the weekday. No single Excel function.",
    keywords: "nth first second third fourth tuesday monday meeting recurring day of week payday" },
];

export const TIMESAVER_FORMULAS: FormulaPackEntry[] = [
  ...TIMESAVER_NUMERIC, ...TIMESAVER_TEXT, ...TIMESAVER_DATE,
];

export const TIMESAVERS_PACK: Pack = {
  id: "timesavers",
  seed: "pack-timesavers",
  group: "Everyday",
  name: "Common Excel Timesavers",
  description: "Conveniences that aren't single Excel functions: weighted stats, list utilities, percent change, CAGR, text cleanup, date helpers, time zones, Spell Number, QR codes.",
  builtin: true,
  defaultActive: true,
  nodes: [
    { path: ["Numbers", "Trigonometry"], entry: HYPOTENUSE_ENTRY },
    ...placeFormulas(["Numbers", "Arithmetic"], TIMESAVER_NUMERIC),
    ...placeFormulas(["Text", "Transform"], TIMESAVER_TEXT),
    ...TIMESAVER_DATE.map((e) => ({ path: ["Date & Time", DATE_FOLDER[e.type]], entry: formulaNode(e) })),
    {
      path: ["Date & Time", "Time Zones"],
      entry: {
        type: "ts-timezone-convert",
        label: "Time Zone Convert",
        description: "Moves a date and time between time zones, daylight saving included. IANA zone names like America/New_York. No single Excel function.",
        keywords: "timezone tz utc gmt offset dst daylight saving meeting convert iana city",
        create: () => new TimeZoneConvertNode(),
      },
    },
    {
      path: ["Date & Time", "Time Zones"],
      entry: {
        type: "ts-world-clock",
        label: "World Clock",
        description: "The current local time in a list of time zones, as a table of place and time. IANA zone names like Europe/London. No Excel equivalent.",
        keywords: "world clock timezone tz local time cities dashboard meeting planner iana",
        create: () => new WorldClockNode(),
      },
    },
    {
      path: ["Docs & Files"],
      entry: {
        type: "ts-qr-code",
        label: "QR Code",
        description: "A QR code from text, a URL, Wi-Fi credentials, or a contact card. Pick the template and fill it in; the code shows on the card and prints from a Report. No network, no Excel equivalent.",
        keywords: "qr code barcode scan url wifi password vcard contact link share phone",
        create: () => new QrCodeNode(),
      },
    },
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
