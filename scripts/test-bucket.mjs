// Runs the vitest files of one or more test buckets (tests/buckets.mjs): a tier (core, surface, nodes, meta) or a
// domain (engine, values, formulas, frames, documents, canvas, ui, figures, integrations, nodes, meta).
//   node scripts/test-bucket.mjs core               the core tier
//   node scripts/test-bucket.mjs engine values      two domains
//   node scripts/test-bucket.mjs --list             every bucket and its file count
//   node scripts/test-bucket.mjs core -- --reporter=verbose   anything after -- goes to vitest
import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TIERS, domainOf, tierOf } from "../tests/buckets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["tests/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"]
  .flatMap((g) => globSync(g, { cwd: ROOT }))
  .filter((f) => !f.includes("node_modules"))
  .map((f) => f.replace(/\\/g, "/"))
  .sort();

const dash = process.argv.indexOf("--");
const names = (dash < 0 ? process.argv.slice(2) : process.argv.slice(2, dash));
const passOn = dash < 0 ? [] : process.argv.slice(dash + 1);

if (names.length === 0 || names.includes("--list")) {
  for (const [tier, domains] of Object.entries(TIERS)) {
    const count = (d) => files.filter((f) => domainOf(f) === d).length;
    console.log(`${tier} (${domains.reduce((n, d) => n + count(d), 0)} files): ${domains.map((d) => `${d} ${count(d)}`).join(", ")}`);
  }
  const loose = files.filter((f) => !domainOf(f));
  if (loose.length) console.log(`unclaimed: ${loose.join(" ")}`);
  process.exit(0);
}

const known = new Set([...Object.keys(TIERS), ...Object.values(TIERS).flat()]);
const unknown = names.filter((n) => !known.has(n));
if (unknown.length) {
  console.error(`unknown bucket: ${unknown.join(", ")} (known: ${[...known].join(", ")})`);
  process.exit(2);
}
const picked = files.filter((f) => {
  const d = domainOf(f);
  return d !== undefined && (names.includes(d) || names.includes(tierOf(d)));
});
console.log(`${names.join(" + ")}: ${picked.length} files`);
const r = spawnSync("npx", ["vitest", "run", ...picked, ...passOn], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status ?? 1);
