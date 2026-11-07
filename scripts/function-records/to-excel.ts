// Writes a family's workbook for Excel: `node scripts/vite-run.mjs scripts/function-records/to-excel.ts <Family>`.
// The author opens fixtures/functions/excel/<Family>.to-excel.xlsx in Excel, lets it recalculate, and saves it as
// fixtures/functions/excel/<Family>.xlsx, which the importer reads.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { familyFunctions } from "./families.ts";
import { buildWorkbook, excelStorage, type RecordCase } from "./workbook.ts";

const ROOT = process.cwd();
const family = process.argv[2];
if (!family) throw new Error("Usage: to-excel.ts <Family>");
const records = new Map<string, RecordCase[]>();
for (const fn of familyFunctions(family)) {
  const groups = JSON.parse(readFileSync(join(ROOT, "fixtures/functions", `${fn}.json`), "utf8")) as Array<{ cases: RecordCase[] }>;
  records.set(fn, groups.flatMap((g) => g.cases.map((c) => ({ formula: c.formula, env: c.env }))));
}
const { xlsx, written, left } = buildWorkbook(records, excelStorage(ROOT));
const out = join(ROOT, "fixtures/functions/excel");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${family}.to-excel.xlsx`), xlsx);
const why = new Map<string, number>();
for (const l of left) why.set(l.why, (why.get(l.why) ?? 0) + 1);
console.log(`${family}: ${written} cases written for Excel, ${left.length} left out`);
for (const [w, n] of why) console.log(`  ${n} ${w}`);
