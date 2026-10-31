// Ports bleeding-edge findings onto the checked-out work branch, one commit each:
//
//   node .github/bleeding-edge/port.mjs <commit>... [--check] [--no-checks]
//
// A finding is a commit on bleeding-edge whose subject starts `Edge:` or `Fix:`. Each is cherry-picked, and a `Fix:`
// commit's `Upgrades: <package>@<version> ...` line moves those packages here (on bleeding-edge they're already moved, so
// the commit's diff can't carry them), keeping each manifest's range style. Then what is
// generated rather than written is regenerated for this branch: the lockfiles, the engine module (plain build:wasm, never
// the optimized one) and the site's prerender snapshots. A conflict in those alone resolves to this branch's copy, since
// they're rebuilt anyway; a conflict anywhere else stops that finding. The typecheck and the unit tests then run, and a
// finding that fails them is taken back off, so the branch ends either with the port or as it began.
//
// --check ports onto a throwaway state and resets to where it started, printing a JSON line per finding (the
// generator's port check). --no-checks skips the typecheck and tests.
//
// Self-contained (no repo imports), so the generator can run it from a copy.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const NO_CHECKS = args.includes("--no-checks");
const commits = args.filter((a) => !a.startsWith("--"));
const FINDING = /^(Edge|Fix): /;
const GENERATED = /(^|\/)(package-lock\.json|Cargo\.lock)$|^src\/graph\/engineWasm\/|^prerender\//;
const ENGINE = /^crates\/solenoid-(core|graph)\//;
const SITE = /^src\/graph\/(landing\/|seeds|packs)/;

function sh(cmd, { quiet = CHECK } = {}) {
  const r = spawnSync("bash", ["-o", "pipefail", "-c", cmd], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (!quiet) process.stdout.write(`$ ${cmd}\n${out.trimEnd().split("\n").slice(-12).join("\n")}\n`);
  return { ok: r.status === 0, out };
}
const must = (cmd) => { const r = sh(cmd, { quiet: true }); if (!r.ok) throw new Error(`${cmd}\n${r.out}`); return r.out.trim(); };
const tail = (s) => s.trimEnd().split("\n").slice(-60).join("\n");
const lines = (s) => s.split("\n").filter(Boolean);

if (!commits.length) { console.error("usage: node .github/bleeding-edge/port.mjs <commit>... [--check] [--no-checks]"); process.exit(2); }
if (must("git status --porcelain --untracked-files=no")) { console.error("port: the working tree has changes; commit or stash them first"); process.exit(2); }
const start = must("git rev-parse HEAD");

// node_modules isn't tracked, so a reset leaves an install behind; put it back to the lockfile's.
let installed = false;
const restoreModules = () => { if (installed) { sh("npm ci --no-audit --no-fund"); installed = false; } };

// `Upgrades: name@1.2.3 other@4.5.6`: each package moves to that version wherever a manifest here lists it, the range's
// prefix kept (`=`, `^`, `~` or none). Returns the manifests it changed, or a reason it couldn't.
const MANIFESTS = () => lines(must("git ls-files 'package.json' '*/Cargo.toml' 'Cargo.toml'"));
function upgrade(message) {
  const wanted = [...message.matchAll(/^Upgrades:\s*(.+)$/gm)].flatMap((m) => m[1].trim().split(/[\s,]+/)).filter(Boolean);
  const touched = new Set();
  for (const w of wanted) {
    const at = w.lastIndexOf("@");
    if (at <= 0) return { why: `Upgrades: "${w}" isn't name@version` };
    const [name, version] = [w.slice(0, at), w.slice(at + 1)];
    const esc = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    let found = false;
    for (const f of MANIFESTS()) {
      const t = readFileSync(f, "utf8");
      const u = f.endsWith("package.json")
        ? t.replace(new RegExp(`("${esc}"\\s*:\\s*")([=^~]?)[^"]*(")`, "g"), (_, a, pre, z) => a + pre + version + z)
        : t.replace(new RegExp(`^(${esc}\\s*=\\s*(?:\\{[^}\\n]*?version\\s*=\\s*)?")([=^~]?)[^"]*(")`, "gm"), (_, a, pre, z) => a + pre + version + z);
      if (u !== t) { writeFileSync(f, u); touched.add(f); }
      if (new RegExp(`("${esc}"\\s*:|^${esc}\\s*=)`, "m").test(t)) found = true;
    }
    if (!found) return { why: `Upgrades: no manifest here lists ${name}` };
  }
  return { touched: [...touched] };
}

function regenerate(changed) {
  if (changed.some((f) => /(^|\/)package\.json$/.test(f))) {
    installed = true;
    const r = sh("npm install --no-audit --no-fund");
    if (!r.ok) return `npm install failed:\n${tail(r.out)}`;
  }
  // Crates reach each other by path, so one manifest's change can move every crate's lockfile; cargo moves each only as far
  // as the manifests now ask.
  const crates = changed.some((f) => /(^|\/)Cargo\.toml$/.test(f)) ? MANIFESTS().filter((f) => f.endsWith("Cargo.toml") && existsSync(f.replace(/Cargo\.toml$/, "Cargo.lock"))) : [];
  for (const toml of crates) {
    const r = sh(`cargo metadata --format-version 1 --manifest-path '${toml}' > /dev/null`);
    if (!r.ok) return `the lockfile beside ${toml} didn't resolve:\n${tail(r.out)}`;
  }
  if (changed.some((f) => ENGINE.test(f) && !GENERATED.test(f))) {
    const lock = sh("cat crates/solenoid-graph/Cargo.lock", { quiet: true }).out;
    const want = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1];
    if (want && !sh("wasm-bindgen --version", { quiet: true }).out.includes(want)) {
      const binstall = sh("cargo binstall --version", { quiet: true }).ok;
      const r = sh(binstall ? `cargo binstall -y --force wasm-bindgen-cli@${want}` : `cargo install --force --locked wasm-bindgen-cli --version ${want}`);
      if (!r.ok) return `wasm-bindgen-cli ${want} didn't install:\n${tail(r.out)}`;
    }
    const r = sh("npm run build:wasm");
    if (!r.ok) return `the engine module didn't build:\n${tail(r.out)}`;
  }
  if (changed.some((f) => SITE.test(f))) {
    const r = sh("node scripts/prerender-site.mjs");
    if (!r.ok) return `the prerender snapshots didn't regenerate:\n${tail(r.out)}`;
  }
  return null;
}

function checks() {
  if (NO_CHECKS) return null;
  for (const [name, cmd] of [["typecheck", "npx tsrs --noEmit"], ["unit tests", "npx vitest run"]]) {
    rmSync("node_modules/.vitest-cache", { recursive: true, force: true });
    const r = sh(cmd);
    if (!r.ok) return `the ${name} failed:\n${tail(r.out)}`;
  }
  return null;
}

const results = [];
let failed = false;
for (const c of commits) {
  const sha = must(`git rev-parse --verify '${c}^{commit}'`);
  const subject = must(`git log -1 --format=%s ${sha}`);
  const result = { sha, subject, ok: false, why: "" };
  results.push(result);
  const before = must("git rev-parse HEAD");
  const back = () => { sh("git cherry-pick --abort", { quiet: true }); must(`git reset --quiet --hard ${before}`); restoreModules(); };
  if (!FINDING.test(subject)) { result.why = "not a finding: its subject doesn't start Edge: or Fix:"; failed = true; continue; }
  const pick = sh(`git cherry-pick --no-commit ${sha}`, { quiet: true });
  if (!pick.ok) {
    const conflicts = lines(must("git diff --name-only --diff-filter=U"));
    const real = conflicts.filter((f) => !GENERATED.test(f));
    if (!conflicts.length || real.length) {
      back();
      result.why = real.length ? `conflicts with this branch in ${real.join(", ")}` : `didn't apply:\n${tail(pick.out)}`;
      failed = true;
      continue;
    }
    for (const f of conflicts) sh(`git checkout --ours -- '${f}' 2>/dev/null || git rm --quiet --cached -- '${f}'`, { quiet: true });
  }
  const message = must(`git log -1 --format=%B ${sha}`).replace(/\n*$/, "");
  const up = upgrade(message);
  if (up.why) { back(); result.why = up.why; failed = true; continue; }
  must("git add -u");
  const changed = [...new Set([...lines(must(`git diff-tree --no-commit-id --name-only -r ${sha}`)), ...up.touched])];
  // Judged by what was written, not by what gets rebuilt: a rebuilt engine module differs by the folder it was built in.
  if (sh(`git diff --cached --quiet -- . ${changed.filter((f) => GENERATED.test(f)).map((f) => `':!${f}'`).join(" ")}`, { quiet: true }).ok) {
    back(); result.ok = true; result.why = "already on this branch"; continue;
  }
  const why = regenerate(changed);
  if (why) { back(); result.why = why; failed = true; continue; }
  must("git add -A");
  if (sh("git diff --cached --quiet", { quiet: true }).ok) { back(); result.ok = true; result.why = "already on this branch"; continue; }
  must(`git commit --quiet --no-verify -F - <<'PORT_MSG'\n${message}\n\nPorted from bleeding-edge ${sha.slice(0, 9)}.\nPORT_MSG`);
  const bad = checks();
  if (bad) { must(`git reset --quiet --hard ${before}`); restoreModules(); result.why = bad; failed = true; continue; }
  result.ok = true;
  result.ported = must("git rev-parse --short HEAD");
  if (!CHECK) installed = false;   // the install now belongs to the port; --check undoes it at the end
}

if (CHECK) {
  must(`git reset --quiet --hard ${start}`);
  restoreModules();
  for (const r of results) console.log(JSON.stringify(r));
} else {
  for (const r of results) console.log(`${r.ok ? "ported" : "NOT ported"}: ${r.sha.slice(0, 9)} ${r.subject}${r.ported ? ` -> ${r.ported}` : ""}${r.why ? `\n  ${r.why.split("\n").join("\n  ")}` : ""}`);
}
if (existsSync("node_modules/.vitest-cache")) rmSync("node_modules/.vitest-cache", { recursive: true, force: true });
process.exit(failed ? 1 : 0);
