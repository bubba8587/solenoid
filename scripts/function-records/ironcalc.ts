// IronCalc's workbooks as harvest sources (tree/specs/computation/function-records.md § Getting Excel's answers):
// every formula cell whose first call is a family function becomes a case, its references turned into `env` names
// holding the referenced cells' saved values. Excel's own answers in these files are never read.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REF, attr, colName, colNum, readBook, unxml, type Book, type Cell, type Sheet } from "./xlsx.ts";
import { printOurs, quote, type Item, type Ours } from "./forms.ts";
import { firstCall, isFormula, namesRead, type Harvested, type LedgerEntry } from "./harvest.ts";

// ─── References ──────────────────────────────────────────────────────────────────



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

export const _test = { shift, refsOf, excelDay, unxml, quote };
