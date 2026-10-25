// [[C118]] formatTravelsWithValue, [[C114]] cardsView, [[D99]] rustIsSpec
// The helpers the Record card shares with the Table popup, frozen for the core's copies
// (`crates/solenoid-core/src/card_helpers.rs`, held to these by its `tests/card_helpers.rs`): a number as a format
// annotation shows it, the Cards view's plan, and the Record layout grammar.
import { it, expect } from "vitest";
import { frozen } from "./coreFixtures";
import { formatNumberWithAnnotation, type FormatAnnotation } from "../../src/graph/formatAnnotationStore";
import { planCards, PROFILE_ROWS, type CardColumnInput, type CardColType } from "../../src/graph/cardLayout";
import { parseRecordLayout } from "../../src/graph/recordLayout";
import { initPackFcExtensions } from "../../src/graph/fcExtensions";
import { settingsStore, type Settings } from "../../src/graph/settingsStore";

/** A small seeded generator, so a refreeze draws the same cases. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUMS = [
  0, -0, 1, -1, 0.5, -0.5, 2.5, -2.5, 1234.5678, -98765.4321, 1e-7, 0.00012345, 1e21, 1.5e22, 123456789.987, Math.PI, Math.E,
  Math.SQRT2, -Math.SQRT2 / 4, 1 / 3, 2 / 3, 0.1 + 0.2, 99.995, 1.005, 46000.75, 46000.999999, 0.125, 12, 1000, 999999.5, -0.0004,
  7.5e-5, 1e9, 2.5e10, -1e12, 0.333333, 12.375, 5 * Math.PI / 6, 1.61803398875, 0.0625, 45.5125, -30.75, 359.9999, 1e-13, NaN,
  Infinity, -Infinity,
];

const FORMATS = [
  "auto", "decimal", "integer", "percent", "fraction", "fraction_adv", "scientific", "custom", "date_dmy", "date_iso",
  "date_us", "date_long", "date_med", "date_dow", "time_24", "time_12", "datetime", "date_custom", "siprefix", "dms", "nosuch",
];

const VARIANTS: Partial<FormatAnnotation>[] = [
  {}, { decimalDigits: 0 }, { decimalDigits: 3, decimalMode: "sigfigs" }, { decimalDigits: 5 }, { grouping: false },
  { negativeStyle: "paren" }, { negativeStyle: "redparen", scaleMode: "k" }, { scaleMode: "m" }, { scaleMode: "b", grouping: false },
  { unit: "usd" }, { unit: "km" }, { unit: "custom", customUnit: " widgets" }, { unit: "custom" }, { unit: "kcal" }, { unit: "nosuch" },
  { unit: "eur", negativeStyle: "paren" }, { customPattern: "#,##0" }, { customPattern: "0.0" }, { customPattern: "0.000%" },
  { customPattern: "YYYY/MM/DD hh:mm" }, { customPattern: "" }, { decimalDigits: 25 }, { decimalDigits: -1 }, { decimalDigits: 2.6 },
  { decimalMode: "sigfigs", decimalDigits: 0 }, { decimalMode: "sigfigs", decimalDigits: 30 }, { decimalMode: "sigfigs", grouping: false },
];

const SETTINGS: Partial<Settings>[] = [{}, { numberDecimals: 0 }, { numberDecimals: 2 }, { numberDecimals: 6, sciAbove: "off" }, { sciAbove: "6" }, { numberDecimals: 3, sciAbove: "12" }];

it("numbers show through their annotations as frozen", () => {
  const cases = frozen("number-format", () => {
    initPackFcExtensions();
    const out: { n: number; ann: FormatAnnotation; settings: Partial<Settings>; text: string }[] = [];
    const run = (settings: Partial<Settings>, each: () => void) => {
      const prior = { numberDecimals: settingsStore.get("numberDecimals"), sciAbove: settingsStore.get("sciAbove") };
      for (const [k, v] of Object.entries(settings)) settingsStore.set(k as "numberDecimals", v as Settings["numberDecimals"]);
      try { each(); } finally { settingsStore.set("numberDecimals", prior.numberDecimals); settingsStore.set("sciAbove", prior.sciAbove); }
    };
    for (const settings of SETTINGS) {
      run(settings, () => {
        for (const format of FORMATS) {
          const variants = Object.keys(settings).length === 0 ? VARIANTS : VARIANTS.slice(0, 4);
          for (const v of variants) {
            const ann = { format, unit: "none", ...v } as FormatAnnotation;
            // A date style past JS's date range throws; a serial that far out names no day.
            const dated = /^(date_|time_|datetime)/.test(format);
            for (const n of NUMS) if (!dated || !(Math.abs(n) >= 2e6)) out.push({ n, ann, settings, text: formatNumberWithAnnotation(n, ann) });
          }
        }
      });
    }
    return out;
  });
  expect(cases.length).toBeGreaterThan(20000);
  // The app's own entry point (the core's formatter since 2026-10-25) answers every frozen case.
  initPackFcExtensions();
  const prior = { numberDecimals: settingsStore.get("numberDecimals"), sciAbove: settingsStore.get("sciAbove") };
  const bad: unknown[] = [];
  try {
    for (const c of cases) {
      settingsStore.set("numberDecimals", (c.settings.numberDecimals ?? prior.numberDecimals) as Settings["numberDecimals"]);
      settingsStore.set("sciAbove", (c.settings.sciAbove ?? prior.sciAbove) as Settings["sciAbove"]);
      const got = formatNumberWithAnnotation(c.n, c.ann);
      if (got !== c.text && bad.length < 5) bad.push({ n: c.n, ann: c.ann, settings: c.settings, want: c.text, got });
    }
  } finally {
    settingsStore.set("numberDecimals", prior.numberDecimals);
    settingsStore.set("sciAbove", prior.sciAbove);
  }
  expect(bad).toEqual([]);
});

const WORDS = [
  "ID", "#", "No", "SKU", "UUID", "Key", "Ref", "Code", "Order ID", "Item No", "Name", "Title", "Product", "Customer", "City",
  "First Name", "Last Name", "Middle Name", "Given Name", "Family Name", "Surname", "firstName", "lastName", "Description", "Notes",
  "Bio", "Summary", "Tags", "Skills", "Genre", "Rating", "Stars", "Progress", "Percent", "Done %", "Battery", "Start", "End",
  "Start Date", "Due", "Check In", "Checkout", "Year", "Founded Year", "Total", "Grand Total", "Amount", "Price", "Unit Price",
  "Cost", "Score", "Value", "Qty", "Age", "Weight", "Color", "Photo", "Image", "Website", "Email", "Active", "Done", "Status",
  "Dept", "Category", "Phone", "x", "Col 1", "v2", "Zip Code",
];

function cellsOf(r: () => number, type: CardColType, rows: number): { cells: string[]; shown?: string[] } {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const blank = r() < 0.2 ? 0.15 : 0;
  const mode = Math.floor(r() * 8);
  const cell = (i: number): string => {
    if (r() < blank) return "";
    switch (type) {
      case "number":
        switch (mode) {
          case 0: return String(i + 1);
          case 1: return String(1800 + Math.floor(r() * 400));
          case 2: return String(Math.round(r() * 5 * 10) / 10);
          case 3: return String(Math.round(r() * 100));
          case 4: return String(Math.round(r() * 1000) / 1000);
          case 5: return String(-50 + Math.round(r() * 100));
          case 6: return pick(["1,234", "12", "  7 ", "3.5e2", "abc", "0x10"]);
          default: return String(Math.round(r() * 1e6) / 100);
        }
      case "date": return String(40000 + Math.floor(r() * 9000));
      case "logical": return pick(["TRUE", "FALSE", "true"]);
      default:
        switch (mode) {
          case 0: return pick(["Web", "App", "Ops", "CS"]);
          case 1: return pick(["SO-1042", "A12", "#77", "INV_9", "x-1"]) + (i % 3);
          case 2: return "An English mathematician and writer, chiefly known for her work on the engine number " + i;
          case 3: return pick(["https://x.org/a.png", "https://example.com/page", "data:image/png;base64,AAA", "mailto:x", "http://a.b/c.JPG?x=1"]);
          case 4: return pick(["#fff", "#A0B1C2", "#12345678", "#ggg", "red"]);
          case 5: return pick(["a, b; c", "ios", "web,q4", "x ; y", "one two"]);
          case 6: return pick(["Ada Lovelace", "Alan Turing", "Grace Hopper", "Edsger Dijkstra", "Barbara Liskov", "Ken Thompson"]) + (r() < 0.3 ? "" : ` ${i}`);
          default: return `w${Math.floor(r() * 30)}`;
        }
    }
  };
  const cells = Array.from({ length: rows }, (_, i) => cell(i));
  if (type !== "number" || r() < 0.6) return { cells };
  const how = pick(["%", "$", "€", "x"]);
  return { cells, shown: cells.map((c) => (c === "" ? "" : how === "%" ? `${c}%` : how === "x" ? c : `${how}${c}`)) };
}

it("the Cards view's plans are as frozen", () => {
  const cases = frozen("card-plans", () => {
    const r = rng(114);
    const out: { cols: CardColumnInput[]; plan: ReturnType<typeof planCards> }[] = [];
    const types: CardColType[] = ["number", "string", "string", "date", "logical"];
    for (let k = 0; k < 3000; k++) {
      const rows = k % 500 === 7 ? PROFILE_ROWS + 50 : Math.floor(r() * 12);
      const n = 1 + Math.floor(r() * 8);
      const cols: CardColumnInput[] = Array.from({ length: n }, () => {
        const type = types[Math.floor(r() * types.length)];
        const name = WORDS[Math.floor(r() * WORDS.length)];
        const { cells, shown } = cellsOf(r, type, rows);
        const c: CardColumnInput = { name, type, cells };
        if (shown) c.shown = shown;
        if (type === "string" && r() < 0.1) c.chip = true;
        if (type === "string" && r() < 0.08) { c.nested = true; if (r() < 0.5) c.lists = true; }
        return c;
      });
      out.push({ cols, plan: planCards(cols) });
    }
    return out;
  });
  expect(cases.length).toBe(3000);
});

it("Record layouts read as frozen", () => {
  const cases = frozen("record-layouts", () => {
    const r = rng(11);
    const parts = ["Item", "Qty", "Price", "Photo", "#Name", "# Name", "Notes", ".", "", "Qty: 40", "Photo*2", "Name * 3", "Item*15",
      "item", "a:b:c", "  # Title : hint ", "Price*0", "Qty*2: n", "#", "*2", "Notes : long text"];
    const out: { text: string; placed: ReturnType<typeof parseRecordLayout> }[] = [];
    for (let k = 0; k < 1500; k++) {
      const lines = Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
        Array.from({ length: 1 + Math.floor(r() * 4) }, () => parts[Math.floor(r() * parts.length)]).join(r() < 0.8 ? "|" : " | "));
      const text = lines.join("\n");
      out.push({ text, placed: parseRecordLayout(text) });
    }
    return out;
  });
  expect(cases.length).toBe(1500);
});
