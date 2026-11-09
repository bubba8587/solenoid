// Reads Excel's answers back: `node scripts/vite-run.mjs scripts/function-records/from-excel.ts <Family>`, after the
// author saved fixtures/functions/excel/<Family>.xlsx in Excel. The only code that writes an `excel` answer
// (tree/specs/computation/function-records.md § Getting Excel's answers); it changes nothing unless every check passes.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readZip } from "./zip.ts";
import { readBook, type Book, type Cell } from "./xlsx.ts";
import { checkExcel, parseExcel, printExcel, quote } from "./forms.ts";
import { familyFunctions } from "./families.ts";
import { CALIBRATION } from "./workbook.ts";
import { keyOf, readRecord, recordText, RECORDS } from "./records.ts";

/** Excel's answer in its constant notation, from the answer cell and the shape cell beside it. */
export function excelAnswer(answer: Cell | undefined, shape: Cell | undefined): string {
  if (!answer || answer.v === undefined) throw new Error("an answer cell Excel left empty");
  const dims = shape?.v ?? "";
  if (!/^\d+x\d+$/.test(dims)) throw new Error(`a shape cell reading ${JSON.stringify(dims)}`);
  switch (answer.t) {
    case "b": return answer.v === "1" ? "TRUE" : "FALSE";
    case "e": return answer.v;
    case "s": case "str": case "inlineStr": {
      if (dims === "1x1") return quote(answer.v);
      const a = parseExcel(answer.v);
      if (a.k !== "array") throw new Error(`a ${dims} answer that isn't an array: ${answer.v}`);
      const [r, c] = dims.split("x").map(Number);
      if (a.rows.length !== r || a.rows.some((row) => row.length !== c)) throw new Error(`an array that isn't ${dims}: ${answer.v}`);
      return printExcel(a);
    }
    default: {
      if (dims !== "1x1") throw new Error(`a ${dims} answer stored as a number`);
      return answer.v;
    }
  }
}

function sheet(book: Book, name: string) {
  const s = book.sheets.find((x) => x.name === name);
  if (!s) throw new Error(`the workbook has no sheet ${name}`);
  return s;
}

/** Every workbook the author saved for a family, in order: <slug>.xlsx, then <slug>.2.xlsx and on. */
export function savedWorkbooks(root: string, family: string): string[] {
  const stem = family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const dir = join(root, RECORDS, "excel");
  const round = (f: string) => Number(/\.(\d+)\.xlsx$/i.exec(f)?.[1] ?? 1);
  return readdirSync(dir)
    .filter((f) => new RegExp(`^${stem}(\\.\\d+)?\\.xlsx$`, "i").test(f))
    .sort((a, b) => round(a) - round(b))
    .map((f) => join(dir, f));
}

/** One saved workbook's answers into the family's records; throws, changing nothing, on any check that fails. */
function importWorkbook(root: string, family: string, path: string): { written: number; unchanged: number } {
  const buf = readFileSync(path);
  const app = /<Application>([^<]*)<\/Application>/.exec(readZip(buf).get("docProps/app.xml")?.toString("utf8") ?? "")?.[1] ?? "";
  if (!/Excel/.test(app) || /Solenoid/.test(app)) throw new Error(`${path}: last saved by ${JSON.stringify(app || "nothing that says")}, not Excel`);
  const book = readBook(buf);
  const cal = sheet(book, "Calibration");
  CALIBRATION.forEach((c, i) => {
    const got = excelAnswer(cal.cells.get(`B${i + 2}`), cal.cells.get(`C${i + 2}`));
    const shape = cal.cells.get(`C${i + 2}`)?.v;
    if (got !== c.answer || shape !== c.shape) throw new Error(`${path}: calibration: ${c.key} reads ${got} (${shape}), expected ${c.answer} (${c.shape}); nothing imported`);
  });
  const updates: Array<[string, NonNullable<ReturnType<typeof readRecord>>]> = [];
  let written = 0, unchanged = 0;
  for (const fn of familyFunctions(family)) {
    const s = book.sheets.find((x) => x.name === fn);
    if (!s) continue; // a later round leaves out a function Excel had answered already
    const record = readRecord(root, fn);
    if (!record) throw new Error(`${fn} has no record`);
    const byKey = new Map(record.flatMap((g) => g.cases).map((c) => [keyOf(c.formula, c.env), c]));
    for (let r = 2; s.cells.has(`A${r}`); r++) {
      const key = s.cells.get(`A${r}`)!.v!;
      const c = byKey.get(key);
      if (!c) throw new Error(`${path}: ${fn} row ${r}: a case the record no longer has (${key})`);
      const ans = excelAnswer(s.cells.get(`B${r}`), s.cells.get(`C${r}`));
      checkExcel(ans);
      if (c.excel === ans) { unchanged++; continue; }
      if (c.excel) throw new Error(`${path}: ${fn} row ${r}: Excel answered ${ans}, where an earlier round answered ${c.excel}`);
      c.excel = ans;
      if (!c.truth) c.truth = "excel";
      written++;
    }
    updates.push([fn, record]);
  }
  for (const [fn, record] of updates) writeFileSync(join(root, RECORDS, `${fn}.json`), recordText(record));
  return { written, unchanged };
}

export function importFamily(root: string, family: string): { written: number; unchanged: number } {
  const files = savedWorkbooks(root, family);
  if (!files.length) throw new Error(`no saved workbook for ${family}`);
  let written = 0, unchanged = 0;
  for (const f of files) { const r = importWorkbook(root, family, f); written += r.written; unchanged += r.unchanged; }
  return { written, unchanged };
}

if (process.argv[1]?.endsWith("from-excel.ts")) {
  const family = process.argv[2];
  if (!family) throw new Error("Usage: from-excel.ts <Family>");
  const { written, unchanged } = importFamily(process.cwd(), family);
  console.log(`${family}: ${written} Excel answers written, ${unchanged} unchanged`);
}
