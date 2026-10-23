// [[C103]] untrustedContentSeams, [[D99]] rustIsSpec
// CSV text as Papa Parse read it and the typed frame `csvToFrame` built from it, frozen for the core's reader
// (`crates/solenoid-core/src/csv.rs`, held to these natively by its `tests/csv.rs`): the rows under each option the
// callers pass, a file's typed columns, the Frame card's typed text, and the text a Sink writes.
import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Papa from "papaparse";
import { frozen, enc } from "./coreFixtures";
import { parseCsvRows, type CsvOptions } from "../../src/graph/csv";
import { csvToFrame } from "../../src/graph/nodes/connection";
import { parseFrameSource } from "../../src/graph/frame";

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

const DELIMS = [",", "\t", "|", ";", "\x1e", "\x1f"];
const EOLS = ["\n", "\r\n", "\r"];

const FAMILIES: Record<string, string[]> = {
  number: [
    "0", "1", "-1", "+3", "42", " 42 ", "-2.5", ".5", "5.", "-.25", "1e5", "1E-3", "2.5e+10", "1,234", "1,234.56", "-12,345,678.9",
    "1e308", "1.7976931348623157e308", "1e309", "-1e-320", "5e-324", "123456789012345678901234567890", "0.1", "007", "-0",
    "9007199254740993", "3.14159265358979323846",
  ],
  numberish: [
    "12,34", "1,23,456", "3,5", "0x1F", "0b1", "Infinity", "-Infinity", "NaN", "1_000", "$5", "5%", "-12.5%", "€3,5", "£1,000",
    "1.2.3", "1e", "e5", "--1", "+-1", "1 000", "(5)", "5-", "١٢٣", "１２", "1,000,00", ",123", "1.", ".", "-", "+",
  ],
  date: [
    "2026-01-03", "2026-12-31", "1900-01-01", "1899-12-30", "2026-01-03T10:20", "2026-01-03 10:20:30", "2026-01-03T10:20:30.5Z",
    "2026-01-03T10:20+05:30", "2026-01-03T23:59:59-0800", "2024-02-29", " 2026-06-15 ",
  ],
  dateish: [
    "2026-13-01", "2026-02-30", "2026-1-3", "01/02/2026", "Jan 3 2026", "2026-01-03T25:00", "2026-01-03T10", "2026/01/03",
    "20260103", "2026-01-03Z", "2026-01-03T10:20:30.Z", "9999-12-31", "0000-01-01",
  ],
  logical: ["TRUE", "FALSE", "true", "false", "True", "False", " TRUE ", "tRuE"],
  logicalish: ["yes", "no", "1", "0", "T", "F", "on", "off", "TRUE!", "truth"],
  text: [
    "apple", "Smith, John", 'He said "hi"', "line one\nline two", "a\r\nb", "tab\there", "pipe|here", "semi;colon", " padded ",
    "é", "😀", "日本語", "naïve café", "=1+2", "+SUM(A1)", "@x", "-", "﻿bom", " nbsp ", " em", "'quoted'",
    '"', '""', "a\"b", "x\x1ey", "u\x1fv", "#comment", "null", "undefined", "NULL",
  ],
  blank: ["", " ", "  ", "\t", " \t "],
};
const FAMILY_NAMES = ["number", "number", "number", "numberish", "date", "date", "dateish", "logical", "logical", "logicalish", "text", "text", "mixed"];

/** One cell written as a field for `delim`: plain where it can be, else quoted, and sometimes in a malformed way. */
function field(r: () => number, v: string, delim: string): string {
  const needs = v.includes(delim) || v.includes('"') || v.includes("\n") || v.includes("\r");
  const roll = r();
  const quoted = () => `"${v.replace(/"/g, '""')}"`;
  if (roll < 0.04) return `"${v}`;
  if (roll < 0.07) return `${quoted()}x`;
  if (roll < 0.1) return `${quoted()}  `;
  if (roll < 0.12) return ` ${quoted()}`;
  if (roll < 0.14) return `${quoted()}\t`;
  if (roll < 0.16) return `a"${v}`;
  if (needs || roll < 0.3) return quoted();
  return v;
}

function cellOf(r: () => number, family: string): string {
  const pick = (xs: string[]) => xs[Math.floor(r() * xs.length)];
  if (r() < 0.12) return pick(FAMILIES.blank);
  if (family === "mixed") return pick(FAMILIES[FAMILY_NAMES[Math.floor(r() * (FAMILY_NAMES.length - 1))]]);
  if (r() < 0.05) return pick(FAMILIES.text);
  return pick(FAMILIES[family]);
}

/** A table of typed columns as CSV text: ragged rows, blank lines, mixed line ends, a BOM, trailing delimiters. */
function tableText(r: () => number): string {
  const delim = r() < 0.5 ? "," : DELIMS[Math.floor(r() * DELIMS.length)];
  const eol = EOLS[Math.floor(r() * EOLS.length)];
  const mixedEols = r() < 0.15;
  const ncols = Math.floor(r() * 7);
  const nrows = r() < 0.15 ? 10 + Math.floor(r() * 6) : Math.floor(r() * 9);
  const families = Array.from({ length: ncols }, () => FAMILY_NAMES[Math.floor(r() * FAMILY_NAMES.length)]);
  const lines: string[] = [];
  const header = families.map((_, j) => (r() < 0.08 ? "" : r() < 0.05 ? "Dup" : `c${j}${r() < 0.1 ? " " : ""}`));
  if (r() < 0.9) lines.push(header.map((h) => field(r, h, delim)).join(delim));
  for (let i = 0; i < nrows; i++) {
    const roll = r();
    if (roll < 0.05) { lines.push(""); continue; }
    if (roll < 0.08) { lines.push(" \t "); continue; }
    if (roll < 0.1) { lines.push(delim.repeat(Math.max(1, ncols - 1))); continue; }
    let cells = families.map((f) => field(r, cellOf(r, f), delim));
    if (r() < 0.1) cells = cells.slice(0, Math.floor(r() * cells.length));
    if (r() < 0.08) cells.push(field(r, cellOf(r, "mixed"), delim));
    let line = cells.join(delim);
    if (r() < 0.06) line += delim;
    lines.push(line);
  }
  let text = mixedEols ? lines.map((l, i) => l + (i < lines.length - 1 ? EOLS[Math.floor(r() * 3)] : "")).join("") : lines.join(eol);
  if (r() < 0.4) text += eol;
  if (r() < 0.05) text += eol + eol;
  if (r() < 0.08) text = "﻿" + text;
  if (r() < 0.04) text = "  " + text + "  \n";
  return text;
}

/** Character soup: short strings over the characters the parser treats specially. */
const SOUP = ["a", "b", "1", "2.5", '"', '"', ",", ",", ";", "\t", "|", "\n", "\n", "\r", "\r\n", " ", "\x1e", "\x1f", "é", "😀", "﻿", "#", "TRUE"];
function soupText(r: () => number): string {
  const n = Math.floor(r() * 30);
  let s = "";
  for (let i = 0; i < n; i++) s += SOUP[Math.floor(r() * SOUP.length)];
  return s;
}

const FIXED = [
  "", " ", "\n", "\r\n", "\r", "\n\n\n", ",", ",,", ",\n,", "﻿", "﻿\n", '"', '""', '"""', '""""', '"a', 'a"', '"a"b"c"',
  '"a" ,b', '"a"\t,b', '"a" \nb', '"a"  ', 'x,"a\n"', '"a\r\nb",c\r\n', "a,b\n1,2\n", "a,b\n1,2\n\n", "a,b\n\n1,2", "a,b\n ,\n1,2",
  "a;b;c\n1;2;3", "a\tb\n1\t2", "a|b\n1|2", "a\x1eb\n1\x1e2", "a\x1fb\n1\x1f2", "a,b;c\n1,2;3", "a;b,c\n1;2,3\n4;5,6", "single",
  "single\ncolumn\nonly", "a,b,c\n1,2\n3,4,5,6", "  a , b  \n  1 , 2  ", '"a,b";c\n"1;2";3', "x\n" + "1;2\n".repeat(12) + "1,2,3,4,5\n",
  "h1,h2\n" + "1,2\n".repeat(9) + "a;b;c;d\n" + "x;y;z;w\n".repeat(5), "\n\na,b\n1,2", "a,b\n1,2\r3,4\r\n5,6", '"a\nb"\n"c""d"',
];

interface RowsCase { text: string; opts: CsvOptions; rows: string[][] }
interface FrameCase { text: string; columns: unknown[] }
interface SourceCase { text: string; columns: unknown[] }
interface UnparseCase { fields: string[]; data: string[][]; text: string }

const OPTS: CsvOptions[] = [{}, { keepBlankLines: true }, { detectDelimiter: true }, { detectDelimiter: true, keepBlankLines: true }];

function texts(): string[] {
  const r = rng(20261023);
  const out = [...FIXED];
  for (const dir of ["assets", "demo-vault/Data", "scripts/demo-video/data"]) {
    const abs = path.resolve(__dirname, "../..", dir);
    for (const f of fs.readdirSync(abs).filter((n) => n.endsWith(".csv")).sort()) out.push(fs.readFileSync(path.join(abs, f), "utf8"));
  }
  for (let i = 0; i < 1600; i++) out.push(tableText(r));
  for (let i = 0; i < 1200; i++) out.push(soupText(r));
  return out;
}

const plainColumns = (columns: readonly object[]) => columns.map((c) => ({ ...c }));

it("CSV text reads into rows as frozen", () => {
  const cases = frozen<RowsCase>("csv-rows", () => texts().flatMap((text) => OPTS.map((opts) => ({ text, opts, rows: parseCsvRows(text, opts) }))));
  expect(cases.length).toBeGreaterThan(10000);
  const bad = cases.filter((c) => JSON.stringify(parseCsvRows(c.text, c.opts)) !== JSON.stringify(c.rows));
  expect(bad.slice(0, 5)).toEqual([]);
});

it("a CSV file reads into a typed frame as frozen", () => {
  const cases = frozen<FrameCase>("csv-frames", () => texts().map((text) => ({ text, columns: plainColumns(csvToFrame(text).columns) })));
  expect(cases.length).toBeGreaterThan(2500);
  const bad = cases.filter((c) => JSON.stringify(enc(plainColumns(csvToFrame(c.text).columns))) !== JSON.stringify(enc(c.columns)));
  expect(bad.slice(0, 5)).toEqual([]);
});

it("a Frame card's CSV text reads into typed source columns as frozen", () => {
  const cases = frozen<SourceCase>("csv-sources", () =>
    texts().filter((t) => !t.trim().startsWith("[")).map((text) => ({ text, columns: plainColumns(parseFrameSource(text)) })));
  expect(cases.length).toBeGreaterThan(2500);
  const bad = cases.filter((c) => JSON.stringify(plainColumns(parseFrameSource(c.text))) !== JSON.stringify(c.columns));
  expect(bad.slice(0, 5)).toEqual([]);
});

const UNPARSE_CELLS = [
  "", " ", "a", "1", "-2.5", "Smith, John", 'He said "hi"', '"', "line\nbreak", "cr\rhere", "crlf\r\nhere", " lead", "trail ",
  "\tTab", "tab\t", "﻿bom", "mid﻿bom", "é😀", "semi;colon", "=1+2", "TRUE", "2026-01-03", "1,234", "'", "''",
];

function unparseCases(): UnparseCase[] {
  const r = rng(7);
  const pick = () => UNPARSE_CELLS[Math.floor(r() * UNPARSE_CELLS.length)];
  const out: UnparseCase[] = [];
  for (let i = 0; i < 800; i++) {
    const ncols = Math.floor(r() * 5);
    const nrows = Math.floor(r() * 5);
    const fields = Array.from({ length: ncols }, pick);
    const data = Array.from({ length: nrows }, () => Array.from({ length: ncols }, pick));
    out.push({ fields, data, text: Papa.unparse({ fields, data }) });
  }
  return out;
}

it("rows write as CSV text as frozen", () => {
  const cases = frozen<UnparseCase>("csv-unparse", unparseCases);
  expect(cases.length).toBe(800);
  const bad = cases.filter((c) => Papa.unparse({ fields: c.fields, data: c.data }) !== c.text);
  expect(bad.slice(0, 5)).toEqual([]);
});
