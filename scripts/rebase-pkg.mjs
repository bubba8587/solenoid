#!/usr/bin/env node
// Resolve a package.json / package-lock.json rebase conflict: keep the new base's manifest,
// reapply only the dependency edits of the commit being replayed, then let npm rebuild the lock.
//   node scripts/rebase-pkg.mjs   (mid-rebase, with the conflict in package.json and/or the lock)
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const sha = sh("git rev-parse REBASE_HEAD").trim();
const read = (rev) => JSON.parse(sh(`git show ${rev}:package.json`));
const [base, before, after] = [read("HEAD"), read(`${sha}^`), read(sha)];

for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
  const b = before[section] ?? {}, a = after[section] ?? {};
  const out = { ...(base[section] ?? {}) };
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (!(k in a)) delete out[k];
    else if (b[k] !== a[k]) out[k] = a[k];
  }
  if (Object.keys(out).length) base[section] = Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
}
writeFileSync("package.json", JSON.stringify(base, null, 2) + "\n");
sh("git checkout HEAD -- package-lock.json");
sh("npm install --package-lock-only --ignore-scripts --no-audit --no-fund");
sh("git add package.json package-lock.json");
console.log(`package.json + lock resolved for ${sha.slice(0, 7)}`);
