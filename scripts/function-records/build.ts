// Builds one family's function records: `node scripts/vite-run.mjs scripts/function-records/build.ts <Family>`.
// It harvests the family's cases, writes fixtures/functions/<NAME>.json for each function with both answer columns
// blank, and writes the harvest ledger; it fails, writing nothing, while any mention is unaccounted for.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { familyFunctions } from "./families.ts";
import { keyOf, readRecord, recordText, type Case, type Group } from "./records.ts";
import { harvest, type Harvested, type LedgerEntry, type Plan } from "./harvest.ts";
import { harvestIronCalc } from "./ironcalc.ts";
import { grid } from "./grid.ts";

const ROOT = process.cwd();
const OUT = join(ROOT, "fixtures/functions");

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


/** One function's record. The same case from several sources is one case; their rule fields merge, and two sources
 *  that state different ones for the same case are an error, never a silent pick. */
export function toRecord(fn: string, harvested: Harvested[], errors: string[]): Group[] {
  const groups = new Map<string, Group>();
  const seen = new Map<string, { c: Case; from: string }>();
  for (const h of harvested.filter((c) => c.fn === fn)) {
    const key = keyOf(h.formula, h.env);
    const prior = seen.get(key);
    if (prior) {
      for (const f of ["truth", "expect", "cite"] as const) {
        const v = h[f] ?? "";
        if (v && prior.c[f] && prior.c[f] !== v) errors.push(`${fn}: ${h.formula}: ${prior.from} says ${f} ${prior.c[f]}, ${h.source} says ${v}`);
        else if (v) prior.c[f] = v;
      }
      continue;
    }
    const name = h.group ?? "Examples";
    if (!groups.has(name)) groups.set(name, { group: name, axis: h.source.startsWith("grid:") ? "argument" : "examples", cite: [], cases: [] });
    const c: Case = { formula: h.formula, env: h.env, excel: "", ours: "", expect: h.expect ?? "", truth: h.truth ?? "", verdict: "", cite: h.cite ?? "" };
    groups.get(name)!.cases.push(c);
    seen.set(key, { c, from: h.source });
  }
  return [...groups.values()];
}

type PlanPart = Omit<Plan, "family" | "functions" | "sources">;
const EMPTY: PlanPart = { envs: {}, files: {}, dispositions: {}, unnamed: {}, baselines: {} };

/** A family's plan, its own decisions over the ones every family shares; an empty one where none is written yet. */
async function planFor(family: string): Promise<PlanPart> {
  const own: PlanPart = await import(`./plans/${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ts`).then((m) => m.plan).catch(() => EMPTY);
  const common: Pick<PlanPart, "files"> = (await import("./plans/common.ts")).plan;
  return { ...EMPTY, ...own, files: { ...common.files, ...own.files } };
}

/** Decisions whose lines only shifted: a key whose line no longer holds the text the last ledger recorded there moves
 *  to the one line in the same file that holds exactly that text. Anything else stays where it is, for the build to
 *  report as stale. */
function relocate(plan: Plan, family: string): Array<[string, string]> {
  let prior: Record<string, { sources?: Record<string, LedgerEntry[]> }> = {};
  try { prior = JSON.parse(readFileSync(join(OUT, "harvest.json"), "utf8")); } catch { return []; }
  const recorded = new Map<string, string>();
  for (const [path, entries] of Object.entries(prior[family]?.sources ?? {})) for (const e of entries) if (e.line) recorded.set(`${path}:${e.line}`, e.text);
  const out: Array<[string, string]> = [];
  for (const table of [plan.dispositions, plan.unnamed]) {
    for (const key of Object.keys(table)) {
      const text = recorded.get(key);
      if (text === undefined) continue;
      const path = key.slice(0, key.lastIndexOf(":"));
      const lines = readFileSync(join(ROOT, path), "utf8").split("\n").map((l) => l.trim().slice(0, 200));
      const at = Number(key.slice(key.lastIndexOf(":") + 1));
      if (lines[at - 1] === text) continue;
      const hits = lines.flatMap((l, i) => (l === text ? [i + 1] : []));
      if (hits.length !== 1 || table[`${path}:${hits[0]}`]) continue;
      table[`${path}:${hits[0]}`] = table[key];
      delete table[key];
      out.push([key, `${path}:${hits[0]}`]);
    }
  }
  return out;
}

async function main() {
  const family = process.argv[2];
  const draft = process.argv.includes("--draft");
  if (!family) throw new Error("Usage: build.ts <Family> [--draft]");
  const functions = familyFunctions(family);
  if (!functions.length) throw new Error(`no family ${family}`);
  const plan: Plan = { ...(await planFor(family)), family, functions, sources: candidateSources() };
  const moves = relocate(plan, family);
  if (moves.length) {
    // The plan file says where each decision now sits, so the next build finds it by its key.
    const file = join(ROOT, "scripts/function-records/plans", `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ts`);
    let src = readFileSync(file, "utf8");
    for (const [from, to] of moves) {
      if (!src.includes(`"${from}"`)) throw new Error(`can't find the key ${from} in ${file}`);
      src = src.replace(`"${from}"`, `"${to}"`);
      console.log(`moved a decision: ${from} -> ${to}`);
    }
    writeFileSync(file, src);
  }
  const { cases, ledger } = harvest(plan, ROOT);
  const ic = harvestIronCalc(ROOT, "fixtures/functions/sources/ironcalc/calc_tests", new Set(functions));
  cases.push(...ic.cases);
  const movedBy = new Map<string, number>();
  for (const c of ic.cases) { const f = c.source.slice(0, c.source.indexOf(".xlsx:") + 5); movedBy.set(f, (movedBy.get(f) ?? 0) + 1); }
  for (const f of new Set([...movedBy.keys(), ...Object.keys(ic.skipped)])) {
    ledger.sources[f] = [{ line: 0, text: "(the workbook's formula cells)", moved: movedBy.get(f) ?? 0 }, ...(ic.skipped[f] ?? [])];
  }
  const noBaseline: string[] = [];
  for (const fn of functions) {
    const b = plan.baselines[fn];
    if (!b) { noBaseline.push(fn); continue; }
    cases.push(...grid(fn, b.formula, b.env ?? [], ledger.errors));
  }
  if (noBaseline.length && !draft) ledger.errors.push(`no baseline, so no edge grid: ${noBaseline.join(", ")}`);
  for (const fn of Object.keys(plan.baselines)) if (!functions.includes(fn)) ledger.errors.push(`${fn}: a baseline for a function outside the family`);
  const nothing = Object.entries(ledger.sources).filter(([, e]) => e.length === 0).map(([p]) => p);
  for (const p of nothing) delete ledger.sources[p];
  if (!draft && (ledger.unaccounted.length || ledger.errors.length)) {
    for (const u of ledger.unaccounted) console.log(`UNACCOUNTED ${u}`);
    for (const e of ledger.errors) console.log(`ERROR ${e}`);
    console.log(`${ledger.unaccounted.length} unaccounted, ${ledger.errors.length} errors; nothing written`);
    process.exitCode = 1;
    return;
  }
  const mergeErrors: string[] = [];
  const records = functions.map((fn) => [fn, toRecord(fn, cases, mergeErrors)] as const);
  if (mergeErrors.length) {
    for (const e of mergeErrors) console.log(`ERROR ${e}`);
    console.log(`${mergeErrors.length} conflicting cases; nothing written`);
    process.exitCode = 1;
    return;
  }
  // A rebuild keeps what the round trip and the run wrote: Excel's and Solenoid's answers and the verdict, by case.
  let kept = 0;
  for (const [fn, record] of records) {
    const prior = new Map((readRecord(ROOT, fn) ?? []).flatMap((g) => g.cases).map((c) => [keyOf(c.formula, c.env), c]));
    for (const c of record.flatMap((g) => g.cases)) {
      const p = prior.get(keyOf(c.formula, c.env));
      if (!p) continue;
      if (p.excel || p.ours || p.verdict) kept++;
      c.excel = p.excel; c.ours = p.ours; c.verdict = p.verdict;
      if (!c.truth && p.truth === "excel") c.truth = "excel";
    }
  }
  mkdirSync(OUT, { recursive: true });
  for (const [fn, record] of records) writeFileSync(join(OUT, `${fn}.json`), recordText(record));
  if (kept) console.log(`${kept} cases kept their answers`);
  const ledgerPath = join(OUT, "harvest.json");
  let all: Record<string, unknown> = {};
  try { all = JSON.parse(readFileSync(ledgerPath, "utf8")); } catch { /* the first family */ }
  // A draft wrote what could be extracted; its open items are what keeps the family from being organized.
  const open = draft && (ledger.unaccounted.length || ledger.errors.length || noBaseline.length)
    ? { draft: true, unaccounted: ledger.unaccounted, problems: ledger.errors, noBaseline } : { draft: false };
  all[family] = { ...open, functions, cases: cases.length, ironcalcOtherFamilies: ic.otherFamilies, sources: ledger.sources };
  writeFileSync(ledgerPath, `${JSON.stringify(all, null, 1)}\n`);
  console.log(`${family}: ${functions.length} records, ${cases.length} cases from ${Object.keys(ledger.sources).length} sources -> ${relative(ROOT, OUT)}`);
  if ("draft" in open && open.draft) console.log(`  a draft: ${ledger.unaccounted.length} mentions undecided, ${ledger.errors.length} cases held back, ${noBaseline.length} functions without a baseline`);
}

await main();
