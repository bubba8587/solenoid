// IronCalc's workbooks as harvest sources (tree/specs/computation/function-records.md § Getting Excel's answers):
// every formula cell whose first call is a family function becomes a case, its references turned into `env` names
// holding the referenced cells' saved values. Excel's own answers in these files are never read.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readZip } from "./zip.ts";
import { printOurs, quote, type Item, type Ours } from "./forms.ts";
import { firstCall, isFormula, namesRead, type Harvested, type LedgerEntry } from "./harvest.ts";

const XML_ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unxml(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (_, n?: string, d?: string, h?: string) =>
      n ? XML_ENTITY[n] : String.fromCodePoint(d ? Number(d) : parseInt(h!, 16)))
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

type Cell = { t?: string; s: number; v?: string; f?: string; fAttrs?: string };
type Sheet = { name: string; cells: Map<string, Cell> };

interface Book { sheets: Sheet[]; dateStyles: Set<number>; date1904: boolean; names: Map<string, string> }

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
  return bare !== "General" && /[ymdhs]/i.test(bare);
}

function readBook(buf: Buffer): Book {
  const z = readZip(buf);
  const text = (n: string) => z.get(n)?.toString("utf8") ?? "";
  const wb = text("xl/workbook.xml");
  const rels = text("xl/_rels/workbook.xml.rels");
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) target.set(attr(m[0], "Id")!, attr(m[0], "Target")!);
  const strings: string[] = [];
  for (const m of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    strings.push([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join(""));
  }
  const styles = text("xl/styles.xml");
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*\/>/g)) custom.set(Number(attr(m[0], "numFmtId")), unxml(attr(m[0], "formatCode") ?? ""));
  const dateStyles = new Set<number>();
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  [...xfs.matchAll(/<xf\b[^>]*>/g)].forEach((m, i) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    if (BUILTIN_DATE.has(id) || (custom.has(id) && isDateCode(custom.get(id)!))) dateStyles.add(i);
  });
  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/>/g)) {
    const t = target.get(attr(m[0], "r:id")!)!;
    const xml = text(t.startsWith("/") ? t.slice(1) : `xl/${t}`);
    const cells = new Map<string, Cell>();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1];
      const inner = c[2] ?? "";
      const f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const t2 = attr(a, "t");
      const isText = /<is>([\s\S]*?)<\/is>/.exec(inner);
      cells.set(attr(a, "r")!, {
        t: t2,
        s: Number(attr(a, "s") ?? 0),
        v: t2 === "s" && v !== undefined ? strings[Number(v)] : isText ? [...isText[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => unxml(x[1])).join("") : v !== undefined ? unxml(v) : undefined,
        f: f ? unxml(f[2] ?? "") : undefined,
        fAttrs: f?.[1],
      });
    }
    sheets.push({ name: unxml(attr(m[0], "name")!), cells });
  }
  // A workbook-wide defined name that refers to cells reads as those cells; one scoped to a sheet or holding a formula doesn't.
  const names = new Map<string, string>();
  for (const m of wb.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const ref = unxml(m[2]);
    if (attr(m[1], "localSheetId") === undefined && new RegExp(`^${REF.source}$`).test(ref)) names.set(unxml(attr(m[1], "name")!), ref);
  }
  return { sheets, dateStyles, date1904: /date1904="(1|true)"/.test(wb), names };
}

// ─── References ──────────────────────────────────────────────────────────────────

const REF = /((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g;

const colNum = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colName = (n: number) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Each reference in a formula, outside its text; a name like LOG10 that is followed by `(` is a call, not a cell. */
function refsOf(formula: string): Array<{ start: number; end: number; m: RegExpMatchArray }> {
  const blanked = formula.replace(/"(?:[^"]|"")*"/g, (s) => " ".repeat(s.length));
  const out: Array<{ start: number; end: number; m: RegExpMatchArray }> = [];
  for (const m of blanked.matchAll(REF)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = blanked[start - 1] ?? "";
    const after = blanked.slice(end).trimStart()[0] ?? "";
    if (/[A-Za-z0-9_.$]/.test(before) || after === "(" || /[A-Za-z0-9_]/.test(blanked[end] ?? "")) continue;
    out.push({ start, end, m: formula.slice(start, end).match(new RegExp(REF.source))! });
  }
  return out;
}

/** A shared formula's copy: every relative part of every reference moved by the copy's offset from the master. */
function shift(formula: string, dr: number, dc: number): string {
  let out = formula;
  for (const { start, end, m } of refsOf(formula).reverse()) {
    const part = (dCol: string, col: string, dRow: string, row: string) =>
      `${dCol}${dCol ? col : colName(colNum(col) + dc)}${dRow}${dRow ? row : Number(row) + dr}`;
    const a = part(m[2], m[3], m[4], m[5]);
    const b = m[7] ? `:${part(m[6], m[7], m[8], m[9])}` : "";
    out = out.slice(0, start) + `${m[1] ?? ""}${a}${b}` + out.slice(end);
  }
  return out;
}

// ─── Values ──────────────────────────────────────────────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A saved serial as the day Excel shows for it, through Excel's own calendar (and its 29 February 1900). */
function excelDay(serial: number, date1904: boolean): { day: string; time?: string } | null {
  const whole = Math.floor(serial);
  const frac = serial - whole;
  let epoch: number; // days from 1970-01-01 to serial 0
  if (date1904) epoch = Date.UTC(1904, 0, 1) / 864e5;
  else if (whole === 60) return null; // 29-Feb-1900, which no calendar has
  else epoch = Date.UTC(1899, 11, whole < 60 ? 31 : 30) / 864e5;
  const d = new Date((epoch + whole) * 864e5);
  const day = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (frac === 0) return { day };
  const ms = Math.round(frac * 864e5);
  const time = `${pad(Math.floor(ms / 36e5))}:${pad(Math.floor(ms / 6e4) % 60)}:${pad(Math.floor(ms / 1e3) % 60)}.${pad(ms % 1000, 3)}`;
  return ms >= 864e5 ? null : { day, time };
}

function itemOf(c: Cell | undefined, book: Book): Item | string {
  if (!c || c.v === undefined) return { k: "blank" };
  switch (c.t) {
    case "s": case "str": case "inlineStr": return { k: "text", v: c.v };
    case "b": return { k: "bool", v: c.v === "1" };
    case "e": return { k: "err", code: c.v };
    default: {
      const n = Number(c.v);
      if (!Number.isFinite(n)) return `a number cell holding ${c.v}`;
      if (!book.dateStyles.has(c.s)) return { k: "num", v: n };
      const d = excelDay(n, book.date1904);
      return d ? { k: "date", ...d } : `a date Solenoid's calendar doesn't have (serial ${n})`;
    }
  }
}

function valueOf(book: Book, sheet: Sheet, m: RegExpMatchArray): Ours | string {
  const name = m[1] ? m[1].slice(0, -1).replace(/^'|'$/g, "").replaceAll("''", "'") : sheet.name;
  const target = book.sheets.find((s) => s.name === name);
  if (!target) return `a reference to a sheet the workbook doesn't have (${name})`;
  const c1 = colNum(m[3]), r1 = Number(m[5]);
  const c2 = m[7] ? colNum(m[7]) : c1, r2 = m[7] ? Number(m[9]) : r1;
  const rows: Item[][] = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    const row: Item[] = [];
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      const it = itemOf(target.cells.get(`${colName(c)}${r}`), book);
      if (typeof it === "string") return it;
      row.push(it);
    }
    rows.push(row);
  }
  return m[7] ? shaped(rows, "range") : rows[0][0];
}

/** Rows of items as a Solenoid value: one row is a list ([[D85]] columnsStayColumns), anything else a matrix. */
function shaped(rows: Item[][], what: string): Ours | string {
  const fams = new Set(rows.flat().filter((i) => i.k !== "blank" && i.k !== "err").map((i) => i.k));
  if (fams.size > 1) return `a ${what} holding more than one kind (${[...fams].join(", ")}), which a Solenoid list can't`;
  return rows.length === 1 ? { k: "list", items: rows[0] } : { k: "table", rows };
}

/** An array constant's rows, `{1,"a";TRUE,#N/A}`, or why it can't be read. */
function arrayConstant(src: string): Item[][] | string {
  const rows: Item[][] = [[]];
  let i = 1;
  while (i < src.length - 1) {
    const rest = src.slice(i, -1);
    let m: RegExpExecArray | null;
    if ((m = /^"((?:[^"]|"")*)"/.exec(rest))) rows[rows.length - 1].push({ k: "text", v: m[1].replaceAll('""', '"') });
    else if ((m = /^(TRUE|FALSE)/i.exec(rest))) rows[rows.length - 1].push({ k: "bool", v: m[1].toUpperCase() === "TRUE" });
    else if ((m = /^#[A-Z0-9/]+[!?A]/.exec(rest))) rows[rows.length - 1].push({ k: "err", code: m[0] });
    else if ((m = /^-?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?/i.exec(rest))) rows[rows.length - 1].push({ k: "num", v: Number(m[0]) });
    else return `an array constant Solenoid can't read (${src})`;
    i += m[0].length;
    const sep = src[i];
    if (sep === ",") i++;
    else if (sep === ";") { rows.push([]); i++; }
    else if (i !== src.length - 1) return `an array constant Solenoid can't read (${src})`;
  }
  return rows;
}

const envName = (own: string, m: RegExpMatchArray) => {
  const sh = m[1] && m[1].slice(0, -1).replace(/^'|'$/g, "") !== own ? `${m[1].slice(0, -1).replace(/^'|'$/g, "").replace(/[^A-Za-z0-9]/g, "_")}_` : "";
  const a = `${m[3]}${m[5]}`;
  return m[7] ? `r_${sh}${a}_${m[7]}${m[9]}` : `c_${sh}${a}`;
};

export interface IronCalcHarvest { cases: Harvested[]; skipped: Record<string, LedgerEntry[]>; otherFamilies: number }

export function harvestIronCalc(root: string, dir: string, family: ReadonlySet<string>): IronCalcHarvest {
  const out: IronCalcHarvest = { cases: [], skipped: {}, otherFamilies: 0 };
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d).sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e.endsWith(".xlsx")) files.push(p); } };
  walk(join(root, dir));
  for (const file of files) {
    const rel = relative(root, file);
    const book = readBook(readFileSync(file));
    for (const sheet of book.sheets) {
      const masters = new Map<string, { at: string; f: string }>();
      for (const [ref, c] of sheet.cells) if (c.f && attr(` ${c.fAttrs ?? ""}`, "t") === "shared") masters.set(attr(` ${c.fAttrs}`, "si")!, { at: ref, f: c.f });
      for (const [ref, c] of sheet.cells) {
        if (c.f === undefined) continue;
        let f = c.f;
        if (!f && attr(` ${c.fAttrs ?? ""}`, "t") === "shared") {
          const master = masters.get(attr(` ${c.fAttrs}`, "si")!);
          if (!master) continue;
          const [, mc, mr] = /^([A-Z]+)(\d+)$/.exec(master.at)!;
          const [, cc, cr] = /^([A-Z]+)(\d+)$/.exec(ref)!;
          f = shift(master.f, Number(cr) - Number(mr), colNum(cc) - colNum(mc));
        }
        f = f.replace(/_xlfn\._xlws\.|_xlfn\.|_xlws\.|_xlpm\./g, "");
        const fn = firstCall(f, family);
        if (!fn || !family.has(fn)) { out.otherFamilies++; continue; }
        const where = `${sheet.name}!${ref}`;
        const skip = (why: string) => (out.skipped[rel] ??= []).push({ line: 0, text: `${where}: =${f}`.slice(0, 200), moved: 0, why });
        if (/(^|[^A-Za-z0-9_$])\$?[A-Z]{1,3}:\$?[A-Z]{1,3}([^A-Za-z0-9_(]|$)/.test(f.replace(/"(?:[^"]|"")*"/g, ""))) { skip("a whole-column reference"); continue; }
        const env = new Map<string, string>();
        let formula = f;
        let bad: string | null = null;
        let k = 0;
        for (const [name, ref] of book.names) {
          const re = new RegExp(`"(?:[^"]|"")*"|(?<![A-Za-z0-9_.])${name.replaceAll(".", "\\.")}(?![A-Za-z0-9_.(])`, "g");
          formula = formula.replace(re, (s) => (s.startsWith('"') ? s : ref));
        }
        formula = formula.replace(/"(?:[^"]|"")*"|\{[^{}]*\}/g, (s) => {
          if (s.startsWith('"') || bad) return s;
          const rows = arrayConstant(s);
          const v = typeof rows === "string" ? rows : shaped(rows, "array constant");
          if (typeof v === "string") { bad = v; return s; }
          const name = `k${++k}`;
          env.set(name, `${name}=${printOurs(v)}`);
          return name;
        });
        for (const { start, end, m } of bad ? [] : refsOf(formula).reverse()) {
          const v = valueOf(book, sheet, m);
          if (typeof v === "string") { bad = v; break; }
          const name = envName(sheet.name, m);
          env.set(name, `${name}=${printOurs(v)}`);
          formula = formula.slice(0, start) + name + formula.slice(end);
        }
        if (bad) { skip(bad); continue; }
        if ([...formula.matchAll(/"((?:[^"]|"")*)"/g)].some((s) => s[1].includes('""'))) { skip("text holding a quote, which a Solenoid formula can't write"); continue; }
        if (!isFormula(formula)) { skip("outside the syntax Excel and Solenoid share (an array constant, an error literal, a spill reference)"); continue; }
        const unbound = namesRead(formula).filter((n) => !env.has(n));
        if (unbound.length) { skip(`reads ${unbound.join(", ")}, a defined name or a name Solenoid reserves`); continue; }
        out.cases.push({ fn, formula, env: [...env.values()].sort(), source: `${rel}:${where}` });
      }
    }
  }
  // A sheet that sweeps one function over hundreds of inputs is its own group, so the examples stay readable.
  const per = new Map<string, number>();
  const sheetOf = (c: Harvested) => `${c.source.slice(0, c.source.lastIndexOf("!"))}\u0000${c.fn}`;
  for (const c of out.cases) per.set(sheetOf(c), (per.get(sheetOf(c)) ?? 0) + 1);
  for (const c of out.cases) if ((per.get(sheetOf(c)) ?? 0) > SWEEP) c.group = "Sweep";
  return out;
}

/** More cases than this from one sheet for one function make a sweep. */
const SWEEP = 200;

export const _test = { shift, refsOf, excelDay, isDateCode, unxml, quote };
