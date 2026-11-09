// The workbook a family's cases travel to Excel in (tree/specs/computation/function-records.md § Getting Excel's
// answers). Every formula is a live dynamic-array formula Excel recalculates on opening; every bound value sits in
// cells on the Values sheet behind its own defined name; a calibration sheet comes first.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readZip, writeZip } from "./zip.ts";
import { parseOurs, type Item, type Ours } from "./forms.ts";
import { keyOf } from "./records.ts";

// ─── How Excel stores each function's name ───────────────────────────────────────

/** Each function name's storage prefix, read off IronCalc's Excel-saved workbooks: the prefixed form wherever Excel
 *  ever wrote one, `""` for a name Excel stores bare. */
export function excelStorage(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!e.endsWith(".xlsx")) continue;
      const z = readZip(readFileSync(p));
      if (!/Excel/.test(z.get("docProps/app.xml")?.toString("utf8") ?? "")) continue;
      for (const [n, buf] of z) {
        if (!n.startsWith("xl/worksheets/sheet")) continue;
        for (const f of buf.toString("utf8").matchAll(/<f\b[^>]*>([\s\S]*?)<\/f>/g)) {
          for (const m of f[1].matchAll(/((?:_xlfn\.|_xlws\.)*)([A-Z][A-Z0-9.]*)\(/g)) {
            const prior = out.get(m[2]);
            if (prior === undefined || m[1].length > prior.length) out.set(m[2], m[1]);
          }
        }
      }
    }
  };
  walk(join(root, "fixtures/functions/sources/ironcalc"));
  for (const [name, pre] of Object.entries(STORED_BY_HAND)) if (!out.has(name)) out.set(name, pre.prefix);
  return out;
}

/** Names no IronCalc workbook shows, with how Excel stores them; each is proved by a calibration case. */
export const STORED_BY_HAND: Record<string, { prefix: string; calibration: { f: string; answer: string } }> = {
  CODE: { prefix: "", calibration: { f: 'CODE("A")', answer: "65" } },
  DOLLAR: { prefix: "", calibration: { f: "DOLLAR(1,2)", answer: '"$1.00"' } },
  FIXED: { prefix: "", calibration: { f: "FIXED(1,2)", answer: '"1.00"' } },
  GEOMEAN: { prefix: "", calibration: { f: "GEOMEAN(2,8)", answer: "4" } },
  MODE: { prefix: "", calibration: { f: "MODE(1,2,2)", answer: "2" } },
  RANK: { prefix: "", calibration: { f: "RANK(2,_vcal3)", answer: "2" } },
  VDB: { prefix: "", calibration: { f: "VDB(2400,300,10,0,1)", answer: "480" } },
  RANDARRAY: { prefix: "_xlfn.", calibration: { f: "ROWS(_xlfn.RANDARRAY(2,3))", answer: "2" } },
};

// ─── Values Excel can be given ───────────────────────────────────────────────────

const DAY_MS = 864e5;

/** A Solenoid day as Excel's serial, through Excel's calendar and its 29 February 1900; null before 1900. */
export function excelSerial(day: string, time?: string): number | null {
  const [y, m, d] = day.split("-").map(Number);
  const days = Date.UTC(y, m - 1, d) / DAY_MS;
  const jan1 = Date.UTC(1900, 0, 1) / DAY_MS;
  // Excel's serial 0 (shown as 0 January 1900) is the day before its first, 31 December 1899.
  if (days < jan1 - 1) return null;
  const serial = days < Date.UTC(1900, 2, 1) / DAY_MS ? days - jan1 + 1 : days - Date.UTC(1899, 11, 30) / DAY_MS;
  if (!time) return serial;
  const [h, mi, s] = time.split(":");
  return serial + (Number(h) * 3600e3 + Number(mi) * 60e3 + Number(s) * 1e3) / DAY_MS;
}

type CellValue = { t: "n"; v: string; date?: boolean } | { t: "s"; v: string } | { t: "b"; v: boolean } | { t: "e"; v: string } | { t: "blank" };

function cellOf(i: Item): CellValue | string {
  switch (i.k) {
    case "num":
      if (!Number.isFinite(i.v) || Object.is(i.v, -0)) return `the number ${i.v}, which Excel has no form for`;
      return { t: "n", v: String(i.v) };
    case "text": return { t: "s", v: i.v };
    case "bool": return { t: "b", v: i.v };
    case "err": return { t: "e", v: i.code };
    case "blank": return { t: "blank" };
    case "date": {
      const s = excelSerial(i.day, i.time);
      return s === null ? `the day ${i.day}, before Excel's calendar starts` : { t: "n", v: String(s), date: true };
    }
    case "cx": {
      if (![i.re, i.im].every(Number.isFinite)) return "a complex number with a non-finite part";
      const neg = i.im < 0 || Object.is(i.im, -0);
      return { t: "s", v: `${i.re}${neg ? "-" : "+"}${Math.abs(i.im)}i` };
    }
  }
}

/** A bound value as rows of cells, or why Excel can't be given it. */
export function cellsOf(v: Ours): CellValue[][] | string {
  const rows: Item[][] =
    v.k === "list" ? [v.items] : v.k === "table" ? v.rows : v.k === "unit" ? [] : v.k === "mixed" || v.k === "lambda" || v.k === "undef" ? [] : [[v as Item]];
  if (v.k === "unit") return "a value with a unit, which Excel has no form for";
  if (v.k === "mixed" || v.k === "lambda" || v.k === "undef") return `a ${v.k} value, which can't be bound in Excel`;
  if (rows.length === 0 || rows.every((r) => r.length === 0)) return "an empty list, which Excel has no form for";
  const out: CellValue[][] = [];
  for (const r of rows) {
    const row: CellValue[] = [];
    for (const i of r) {
      const c = cellOf(i);
      if (typeof c === "string") return c;
      row.push(c);
    }
    out.push(row);
  }
  return out;
}

// ─── Formulas as Excel stores them ───────────────────────────────────────────────

/** A case's formula as Excel stores it: bound names renamed, functions prefixed, LET and LAMBDA names `_xlpm.`. */
export function excelFormula(formula: string, rename: ReadonlyMap<string, string>, storage: ReadonlyMap<string, string>): string {
  const params = new Set<string>();
  for (const m of formula.matchAll(/\b(LAMBDA|LET)\s*\(/gi)) {
    let depth = 0, start = m.index! + m[0].length;
    for (let j = start; j < formula.length; j++) {
      const c = formula[j];
      if (c === '"') { j = formula.indexOf('"', j + 1); continue; }
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0) { const p = formula.slice(start, j).trim(); if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(p)) params.add(p); start = j + 1; }
    }
  }
  let out = "";
  for (const m of formula.matchAll(/"[^"]*"|[A-Za-z_λ][A-Za-z0-9_λ]*(?:\.[A-Za-z0-9_λ]+)*|[0-9.]+[eE][+-]?\d+|[\s\S]/g)) {
    const tok = m[0];
    if (!/^[A-Za-z_λ]/.test(tok)) { out += tok; continue; }
    const after = formula.slice(m.index! + tok.length).trimStart();
    if (after.startsWith("(")) {
      const up = tok.toUpperCase();
      const pre = storage.get(up);
      if (pre === undefined) throw new Error(`calls ${up}, which no Excel-saved workbook shows`);
      out += pre + up;
    } else if (rename.has(tok)) out += rename.get(tok);
    else if (/^(TRUE|FALSE)$/i.test(tok)) out += tok.toUpperCase();
    else if (params.has(tok)) out += `_xlpm.${tok}`;
    else if (/^(e|pi|tau|phi)$/i.test(tok)) throw new Error(`uses Solenoid's constant ${tok}, which Excel doesn't have`);
    else throw new Error(`${formula}: the name ${tok} is neither bound nor a parameter`);
  }
  return out;
}

// ─── The workbook ────────────────────────────────────────────────────────────────

export interface RecordCase { formula: string; env: string[] }

/** The functions whose answer changes on every recalculation: their cases record a property, never Excel's value. */
const VOLATILE = /\b(TODAY|NOW|RAND|RANDARRAY|RANDBETWEEN)\s*\(/i;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Text as a cell's XML: control characters and a literal `_xHHHH_` written as Excel escapes them. */
const escText = (s: string) => esc(s.replace(/_(x[0-9A-Fa-f]{4}_)/g, "_x005F_$1").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}_`));
const space = (s: string) => (/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : "");

const colName = (n: number) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function cellXml(ref: string, c: CellValue): string {
  switch (c.t) {
    case "n": return `<c r="${ref}"${c.date ? ' s="1"' : ""}><v>${c.v}</v></c>`;
    case "s": return `<c r="${ref}" t="inlineStr"><is><t${space(c.v)}>${escText(c.v)}</t></is></c>`;
    case "b": return `<c r="${ref}" t="b"><v>${c.v ? 1 : 0}</v></c>`;
    case "e": return `<c r="${ref}" t="e"><v>${esc(c.v)}</v></c>`;
    case "blank": return "";
  }
}

const ANSWER = (f: string) => `_xlfn.LET(_xlpm.r,${f},IF(ISERROR(ROWS(_xlpm.r)),_xlpm.r,IF(ROWS(_xlpm.r)*COLUMNS(_xlpm.r)=1,_xlpm.r,_xlfn.ARRAYTOTEXT(_xlpm.r,1))))`;
const SHAPE = (f: string) => `_xlfn.LET(_xlpm.r,${f},IFERROR(ROWS(_xlpm.r)&"x"&COLUMNS(_xlpm.r),"1x1"))`;

/** The calibration sheet's cases: a formula as Excel stores it and what Excel's documented rules make it answer. */
export const CALIBRATION: ReadonlyArray<{ key: string; f: string; shape: string; answer: string }> = [
  { key: "a number", f: "1/4", shape: "1x1", answer: "0.25" },
  { key: "a text", f: '"a"&"b"', shape: "1x1", answer: '"ab"' },
  { key: "a logical", f: "1=1", shape: "1x1", answer: "TRUE" },
  { key: "an error", f: "NA()", shape: "1x1", answer: "#N/A" },
  { key: "a date", f: "DATE(2024,3,5)", shape: "1x1", answer: "45356" },
  { key: "a 1x3 array", f: "_xlfn.SEQUENCE(1,3)", shape: "1x3", answer: "{1,2,3}" },
  { key: "a 2x2 array", f: "_xlfn.SEQUENCE(2,2)", shape: "2x2", answer: "{1,2;3,4}" },
  { key: "a bound cell holding the text 5, which SUM skips", f: "SUM(_vcal1)", shape: "1x1", answer: "0" },
  { key: "LEFT over a bound row, a dynamic array", f: "LEFT(_vcal2,1)", shape: "1x2", answer: '{"a","c"}' },
  ...Object.entries(STORED_BY_HAND).map(([name, s]) => ({ key: `${name}, stored as written by hand`, f: s.calibration.f, shape: "1x1", answer: s.calibration.answer })),
];
const CALIBRATION_VALUES: ReadonlyArray<[string, CellValue[][]]> = [
  ["_vcal1", [[{ t: "s", v: "5" }]]],
  ["_vcal2", [[{ t: "s", v: "ab" }, { t: "s", v: "cd" }]]],
  ["_vcal3", [[{ t: "n", v: "1" }, { t: "n", v: "2" }, { t: "n", v: "3" }]]],
];

export interface Built { xlsx: Buffer; written: number; left: Array<{ fn: string; formula: string; why: string }> }

/** One family's workbook. `records` maps each function to its cases; `storage` is how Excel stores each name. */
export function buildWorkbook(records: ReadonlyMap<string, RecordCase[]>, storage: ReadonlyMap<string, string>): Built {
  const names = new Map<string, string>(); // binding text → defined name
  const valueRows: string[] = [];
  const defined: Array<[string, string]> = [];
  let vRow = 1;
  const place = (name: string, rows: CellValue[][]) => {
    const top = vRow;
    rows.forEach((r, i) => valueRows.push(`<row r="${top + i}">${r.map((c, j) => cellXml(`${colName(j + 1)}${top + i}`, c)).join("")}</row>`));
    const width = Math.max(...rows.map((r) => r.length));
    const last = `$${colName(width)}$${top + rows.length - 1}`;
    defined.push([name, rows.length === 1 && width === 1 ? `Values!$A$${top}` : `Values!$A$${top}:${last}`]);
    vRow += rows.length + 1;
  };
  for (const [n, rows] of CALIBRATION_VALUES) place(n, rows);
  const caseRow = (r: number, key: string, f: string) =>
    `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t${space(key)}>${escText(key)}</t></is></c>` +
    `<c r="B${r}" cm="1"><f t="array" ref="B${r}">${esc(ANSWER(f))}</f></c>` +
    `<c r="C${r}" cm="1"><f t="array" ref="C${r}">${esc(SHAPE(f))}</f></c></row>`;
  const header = '<row r="1"><c r="A1" t="inlineStr"><is><t>case</t></is></c><c r="B1" t="inlineStr"><is><t>answer</t></is></c><c r="C1" t="inlineStr"><is><t>shape</t></is></c></row>';
  const sheets: Array<[string, string]> = [];
  sheets.push(["Calibration", header + CALIBRATION.map((c, i) => caseRow(i + 2, c.key, c.f)).join("")]);
  const left: Built["left"] = [];
  let written = 0;
  for (const [fn, cases] of records) {
    const rows: string[] = [header];
    for (const c of cases) {
      // Check every binding and the formula first; only a case that will be written places its values.
      const rename = new Map<string, string>();
      const fresh: Array<[string, string, CellValue[][]]> = [];
      let why: string | null = null;
      for (const e of c.env) {
        const name = e.slice(0, e.indexOf("="));
        if (names.has(e)) { rename.set(name, names.get(e)!); continue; }
        const cells = cellsOf(parseOurs(e.slice(e.indexOf("=") + 1)));
        if (typeof cells === "string") { why = cells; break; }
        const id = `_v${names.size + fresh.length + 1}`;
        fresh.push([e, id, cells]);
        rename.set(name, id);
      }
      let f = "";
      const volatile = VOLATILE.exec(c.formula.replace(/"[^"]*"/g, '""'));
      if (!why && volatile) why = `calls ${volatile[1].toUpperCase()}, which answers differently on every recalculation`;
      if (!why) try { f = excelFormula(c.formula, rename, storage); } catch (err) { why = (err as Error).message; }
      if (why) { left.push({ fn, formula: c.formula, why }); continue; }
      for (const [e, id, cells] of fresh) { names.set(e, id); place(id, cells); }
      rows.push(caseRow(rows.length + 1, keyOf(c.formula, c.env), f));
      written++;
    }
    if (rows.length === 1) continue;
    sheets.push([fn, rows.join("")]);
  }
  sheets.splice(1, 0, ["Values", valueRows.join("")]);
  return { xlsx: pack(sheets, defined), written, left };
}

const METADATA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>';

function pack(sheets: Array<[string, string]>, defined: Array<[string, string]>): Buffer {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files: Array<[string, string]> = [
    ["[Content_Types].xml", `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
    ["_rels/.rels", `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ["docProps/app.xml", `${head}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Solenoid function records</Application></Properties>`],
    ["xl/workbook.xml", `${head}<workbook ${ns}><sheets>${sheets.map(([n], i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames>${defined.map(([n, r]) => `<definedName name="${n}">${r}</definedName>`).join("")}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
    ["xl/_rels/workbook.xml.rels", `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>`],
    ["xl/styles.xml", `${head}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/metadata.xml", METADATA],
    ...sheets.map(([, rows], i) => [`xl/worksheets/sheet${i + 1}.xml`, `${head}<worksheet ${ns}><sheetData>${rows}</sheetData></worksheet>`] as [string, string]),
  ];
  return writeZip(files.map(([n, s]) => [n, Buffer.from(s, "utf8")] as const));
}
