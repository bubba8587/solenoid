// Writes the workbooks for Excel: `node scripts/vite-run.mjs scripts/function-records/to-excel.ts <Family>… | --all`.
// Each holds a family's cases Excel hasn't answered yet; the author opens fixtures/functions/excel/<slug>.to-excel.xlsx in
// Excel, lets it recalculate and saves it beside it as <slug>.xlsx (a later round <slug>.2.xlsx, and on), every one kept.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { families, familyFunctions } from "./families.ts";
import { buildWorkbook, excelStorage, type RecordCase } from "./workbook.ts";
import { RECORDS } from "./records.ts";

export const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const ROOT = process.cwd();
const asked = process.argv.slice(2);
const list = asked.includes("--all") ? families() : asked;
if (!list.length) throw new Error("Usage: to-excel.ts <Family>… | --all");
const storage = excelStorage(ROOT);
const out = join(ROOT, RECORDS, "excel");
mkdirSync(out, { recursive: true });
const unknown = new Map<string, number>();
for (const family of list) {
  const records = new Map<string, RecordCase[]>();
  for (const fn of familyFunctions(family)) {
    const p = join(ROOT, RECORDS, `${fn}.json`);
    if (!existsSync(p)) continue;
    const groups = JSON.parse(readFileSync(p, "utf8")) as Array<{ cases: Array<RecordCase & { excel: string }> }>;
    records.set(fn, groups.flatMap((g) => g.cases.filter((c) => !c.excel).map((c) => ({ formula: c.formula, env: c.env }))));
  }
  const file = join(out, `${slug(family)}.to-excel.xlsx`);
  const { xlsx, written, left } = buildWorkbook(records, storage);
  if (written) writeFileSync(file, xlsx);
  else if (existsSync(file)) rmSync(file);
  const why = new Map<string, number>();
  for (const l of left) {
    const m = /^calls (\S+), which no Excel-saved workbook shows$/.exec(l.why);
    if (m) unknown.set(m[1], (unknown.get(m[1]) ?? 0) + 1);
    const w = m ? "calls a function no Excel-saved workbook shows" : l.why;
    why.set(w, (why.get(w) ?? 0) + 1);
  }
  console.log(`${family}: ${written} cases for Excel${written ? ` -> ${slug(family)}.to-excel.xlsx` : ""}, ${left.length} left out`);
  for (const [w, n] of why) console.log(`  ${n} ${w}`);
}
if (unknown.size) console.log(`functions no Excel-saved workbook shows: ${[...unknown.keys()].sort().join(" ")}`);
