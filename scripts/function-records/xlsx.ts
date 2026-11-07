// An .xlsx workbook's sheets, cells, styles and defined names, read with nothing but the zip module: what the
// IronCalc harvest and the importer of Excel's answers both read (tree/specs/computation/function-records.md).
import { readZip } from "./zip.ts";

const XML_ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function unxml(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (_, n?: string, d?: string, h?: string) =>
      n ? XML_ENTITY[n] : String.fromCodePoint(d ? Number(d) : parseInt(h!, 16)))
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

export type Cell = { t?: string; s: number; v?: string; f?: string; fAttrs?: string };
export type Sheet = { name: string; cells: Map<string, Cell> };

export interface Book { sheets: Sheet[]; dateStyles: Set<number>; date1904: boolean; names: Map<string, string> }

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function isDateCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
  return bare !== "General" && /[ymdhs]/i.test(bare);
}

export function readBook(buf: Buffer): Book {
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


export const REF = /((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g;
export const colNum = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export const colName = (n: number) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
