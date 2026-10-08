// Prints the Add-menu search samples as a Markdown table: npm run search-samples [-- --misses]
// The samples run under vitest (the catalog needs Vite's module environment); this formats what they found.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "search-samples-")), "rows.json");
spawnSync("npx", ["vitest", "run", "tests/graph/searchSamples.test.ts"], {
  env: { ...process.env, SEARCH_SAMPLES_OUT: out },
  stdio: "ignore",
});
if (!fs.existsSync(out)) {
  console.error("The search samples did not run; try: npx vitest run tests/graph/searchSamples.test.ts");
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(out, "utf8"));
const shown = process.argv.includes("--misses") ? rows.filter((r) => !r.pass) : rows;
const cell = (s) => String(s).replace(/\|/g, "\\|");
console.log("| Kind | Query | Should land on | Landed | Top results |");
console.log("|---|---|---|---|---|");
for (const r of shown) {
  const landed = r.pass ? `✓ #${r.rank}` : `✗ ${r.rank ? `#${r.rank}` : "not found"} (want top ${r.within})`;
  console.log(`| ${cell(r.kind)} | \`${cell(r.query)}\`${r.pack ? ` (${r.pack} pack)` : ""} | ${cell(r.want.join(", "))} | ${landed} | ${cell(r.top.map((t) => t.label).join(" · "))} |`);
}
const passed = rows.filter((r) => r.pass).length;
console.log(`\n${passed} of ${rows.length} land where they should.`);
process.exit(passed === rows.length ? 0 : 1);
