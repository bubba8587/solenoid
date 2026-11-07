// Builds one family's function records: `node scripts/vite-run.mjs scripts/function-records/build.ts <Family>`.
// It harvests the family's cases, writes fixtures/functions/<NAME>.json for each function with both answer columns
// blank, and writes the harvest ledger; it fails, writing nothing, while any mention is unaccounted for.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildFunctionReference } from "../../src/graph/functionReference";
import { harvest, type Harvested, type Plan } from "./harvest.ts";

const ROOT = process.cwd();
const OUT = join(ROOT, "fixtures/functions");

/** A function's family: the top-level Add menu group of the node its Function Reference row names. */
export function familyFunctions(family: string): string[] {
  const out = new Set<string>();
  for (const r of buildFunctionReference()) if (r.excel && r.location[0] === family) out.add(r.excel.toUpperCase());
  return [...out].sort();
}

/** Every file a mention could sit in: the tests, the core's inline tests, the specs, and the two docs that state answers. */
export function candidateSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string, keep: (p: string) => boolean) => {
    for (const e of readdirSync(join(ROOT, dir))) {
      const p = join(dir, e);
      if (statSync(join(ROOT, p)).isDirectory()) { if (e !== "node_modules" && e !== "target") walk(p, keep); }
      else if (keep(p)) out.push(p);
    }
  };
  walk("tests", (p) => /\.(ts|mjs)$/.test(p));
  walk("crates/solenoid-core/tests", (p) => p.endsWith(".rs"));
  walk("crates/solenoid-core/src", (p) => p.endsWith(".rs") && readFileSync(join(ROOT, p), "utf8").includes("#[cfg(test)]"));
  walk("tree/specs", (p) => p.endsWith(".md") && !p.endsWith("function-records.md"));
  out.push("docs/node-coverage.md", "docs/backlog.md");
  return out.sort();
}

interface Case { formula: string; env: string[]; excel: string; ours: string; expect: string; truth: string; verdict: string; cite: string }
interface Group { group: string; axis: string; cite: string[]; cases: Case[] }

export function toRecord(fn: string, harvested: Harvested[]): Group[] {
  const groups = new Map<string, Group>();
  const seen = new Set<string>();
  for (const h of harvested.filter((c) => c.fn === fn)) {
    const key = `${h.formula}\u0000${h.env.join("\u0000")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = h.group ?? "Examples";
    if (!groups.has(name)) groups.set(name, { group: name, axis: "examples", cite: [], cases: [] });
    groups.get(name)!.cases.push({ formula: h.formula, env: h.env, excel: "", ours: "", expect: h.expect ?? "", truth: h.truth ?? "", verdict: "", cite: h.cite ?? "" });
  }
  return [...groups.values()];
}

async function main() {
  const family = process.argv[2];
  if (!family) throw new Error("Usage: build.ts <Family>");
  const planModule = await import(`./plans/${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ts`);
  const functions = familyFunctions(family);
  const plan: Plan = { ...planModule.plan, family, functions, sources: candidateSources() };
  const { cases, ledger } = harvest(plan, ROOT);
  const nothing = Object.entries(ledger.sources).filter(([, e]) => e.length === 0).map(([p]) => p);
  for (const p of nothing) delete ledger.sources[p];
  if (ledger.unaccounted.length || ledger.errors.length) {
    for (const u of ledger.unaccounted) console.log(`UNACCOUNTED ${u}`);
    for (const e of ledger.errors) console.log(`ERROR ${e}`);
    console.log(`${ledger.unaccounted.length} unaccounted, ${ledger.errors.length} errors; nothing written`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const fn of functions) writeFileSync(join(OUT, `${fn}.json`), `${JSON.stringify(toRecord(fn, cases), null, 1)}\n`);
  const ledgerPath = join(OUT, "harvest.json");
  let all: Record<string, unknown> = {};
  try { all = JSON.parse(readFileSync(ledgerPath, "utf8")); } catch { /* the first family */ }
  all[family] = { functions, cases: cases.length, sources: ledger.sources };
  writeFileSync(ledgerPath, `${JSON.stringify(all, null, 1)}\n`);
  console.log(`${family}: ${functions.length} records, ${cases.length} cases from ${Object.keys(ledger.sources).length} sources -> ${relative(ROOT, OUT)}`);
}

await main();
