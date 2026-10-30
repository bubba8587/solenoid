// Builds the `bleeding-edge` branch: the most recently pushed branch with every dependency at its newest version,
// majors included, and a report of what moved and what broke (.github/bleeding-edge/REPORT.md and REPORT.json).
// The branch is regenerated from its base on every run, never rebased, so it is always one commit on top of current
// work. ANALYSIS.md, the weekly reading of the release notes, carries over from the previous run.
//
//   node .github/bleeding-edge/bleeding-edge.mjs [--push] [--base <branch>]
//
// Self-contained (no repo imports), so the workflow can run it from a copy while the base branch is checked out.
// Needs on PATH: node/npm, cargo with clippy and the wasm32 target, cargo-upgrade (cargo-edit). Optional:
// cargo-binstall (fast wasm-bindgen-cli install), cargo-audit, WebKitGTK dev libraries (the desktop check).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const PUSH = args.includes("--push");
const BRANCH = "bleeding-edge";
const OUT = ".github/bleeding-edge";
const ALL_CRATES = ["crates/solenoid-core", "crates/solenoid-graph", "crates/solenoid-parquet", "crates/solenoid-schedule", "src-tauri"];
// Branches that aren't where work happens: production (it only takes releases), this one, session and bot branches.
const NOT_WORK = /^(main$|master$|bleeding-edge$|ccr-|claude\/|vercel\/|dependabot\/|renovate\/)/;

function sh(cmd, { quiet = false, timeout = 30 * 60_000 } = {}) {
  const t = Date.now();
  const r = spawnSync("bash", ["-o", "pipefail", "-c", cmd], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (!quiet) process.stdout.write(`$ ${cmd}\n${tail(out, 15)}\n`);
  return { ok: r.status === 0, out, secs: Math.round((Date.now() - t) / 1000) };
}
const must = (cmd) => { const r = sh(cmd, { quiet: true }); if (!r.ok) throw new Error(`${cmd}\n${r.out}`); return r.out.trim(); };
const tail = (s, n) => s.trimEnd().split("\n").slice(-n).join("\n");
const has = (cmd) => sh(`${cmd} --version`, { quiet: true }).ok;

// ── pick the base and start the branch from it ──────────────────────────────────────────────────────────────
must("git fetch --quiet origin '+refs/heads/*:refs/remotes/origin/*'");
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]
  : must("git for-each-ref --sort=-committerdate --format='%(refname:lstrip=3)' refs/remotes/origin").split("\n").find((b) => b !== "HEAD" && !NOT_WORK.test(b));
const baseSha = must(`git rev-parse origin/${base}`);
const prevAnalysis = sh(`git show origin/${BRANCH}:${OUT}/ANALYSIS.md`, { quiet: true });
must(`git checkout --quiet -B ${BRANCH} origin/${base}`);
console.log(`base: ${base} @ ${baseSha.slice(0, 9)}`);
const CRATES = ALL_CRATES.filter((d) => existsSync(`${d}/Cargo.toml`));

// ── snapshot, upgrade, diff ─────────────────────────────────────────────────────────────────────────────────
function npmLock() {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const v = new Map();
  for (const [k, p] of Object.entries(lock.packages ?? {})) if (k && p.version && !p.link) v.set(k.replace(/^.*node_modules\//, "") + (k.split("node_modules/").length > 2 ? ` (in ${k.split("/node_modules/")[0].replace(/^node_modules\//, "")})` : ""), p.version);
  return v;
}
function npmDirect() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return new Map(Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }));
}
function cargoLock(dir) {
  const f = `${dir}/Cargo.lock`;
  const v = new Map();
  if (!existsSync(f)) return v;
  for (const m of readFileSync(f, "utf8").matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)) v.set(m[1], [...(v.get(m[1]) ?? []), m[2]]);
  return v;
}
function cargoDirect(dir) {
  const names = new Set();
  let inDeps = false;
  for (const line of readFileSync(`${dir}/Cargo.toml`, "utf8").split("\n")) {
    if (/^\s*\[/.test(line)) inDeps = /dependencies\]\s*$/.test(line);
    else if (inDeps) { const m = line.match(/^([A-Za-z0-9_-]+)\s*=/); if (m && !/path\s*=/.test(line)) names.add(m[1]); }
  }
  return names;
}
const semverMajor = (v) => { const [a, b] = String(v).replace(/^[^\d]*/, "").split("."); return a === "0" ? `0.${b}` : a; };

const before = { npm: npmLock(), npmDirect: npmDirect(), cargo: Object.fromEntries(CRATES.map((d) => [d, cargoLock(d)])) };

const setup = [];
const step = (name, cmd) => { const r = sh(cmd); setup.push({ name, cmd, ok: r.ok, secs: r.secs, log: r.ok ? "" : tail(r.out, 60) }); return r.ok; };

step("npm: every package.json range to the newest release", "npx --yes npm-check-updates@latest --upgrade --root --workspaces");
rmSync("node_modules", { recursive: true, force: true });
rmSync("package-lock.json", { force: true });
let peerNote = "";
if (!step("npm: fresh lockfile (newest transitive versions too)", "npm install --no-audit --no-fund")) {
  peerNote = "The plain install failed (usually a peer range the newest versions don't satisfy), so this ran with --legacy-peer-deps.";
  step("npm: fresh lockfile, ignoring peer ranges", "npm install --no-audit --no-fund --legacy-peer-deps");
}
for (const d of CRATES) {
  step(`cargo: ${d} manifest to the newest releases`, `cargo upgrade --incompatible allow --pinned allow --manifest-path ${d}/Cargo.toml`);
  step(`cargo: ${d} lockfile`, `cargo update --manifest-path ${d}/Cargo.toml`);
}

const after = { npm: npmLock(), npmDirect: npmDirect(), cargo: Object.fromEntries(CRATES.map((d) => [d, cargoLock(d)])) };

const changes = [];
for (const name of new Set([...before.npm.keys(), ...after.npm.keys()])) {
  const [a, b] = [before.npm.get(name), after.npm.get(name)];
  if (a === b) continue;
  const direct = after.npmDirect.has(name) || before.npmDirect.has(name);
  changes.push({ eco: "npm", name, from: a ?? null, to: b ?? null, direct, major: !!a && !!b && semverMajor(a) !== semverMajor(b) });
}
for (const d of CRATES) {
  const direct = cargoDirect(d);
  for (const name of new Set([...before.cargo[d].keys(), ...after.cargo[d].keys()])) {
    const [a, b] = [(before.cargo[d].get(name) ?? []).join(", "), (after.cargo[d].get(name) ?? []).join(", ")];
    if (a === b) continue;
    const top = (s) => s.split(", ").at(-1);
    changes.push({ eco: "cargo", where: d, name, from: a || null, to: b || null, direct: direct.has(name), major: !!a && !!b && semverMajor(top(a)) !== semverMajor(top(b)) });
  }
}

// Release-note links for direct dependencies, where the package names a GitHub repository.
function repoOf(c) {
  const url = c.eco === "npm" ? sh(`npm view ${c.name} repository.url`, { quiet: true }).out
    : (() => { try { return JSON.parse(sh(`curl -sf -A solenoid-bleeding-edge https://crates.io/api/v1/crates/${c.name}`, { quiet: true }).out).crate.repository ?? ""; } catch { return ""; } })();
  const m = url.match(/github\.com[/:]([^/]+\/[^/#.\s]+)/);
  return m ? `https://github.com/${m[1]}/releases` : c.eco === "npm" ? `https://www.npmjs.com/package/${c.name}?activeTab=versions` : `https://crates.io/crates/${c.name}/versions`;
}
for (const c of changes) if (c.direct && c.to) c.notes = repoOf(c);

// The engine module is rebuilt for the new crates below, never optimized (CLAUDE.md).
const bindgen = (cargoLock("crates/solenoid-graph").get("wasm-bindgen") ?? [])[0];
if (bindgen && !sh("wasm-bindgen --version", { quiet: true }).out.includes(bindgen)) {
  step(`wasm-bindgen-cli ${bindgen}`, has("cargo binstall") ? `cargo binstall -y --force wasm-bindgen-cli@${bindgen}` : `cargo install --force --locked wasm-bindgen-cli --version ${bindgen}`);
}
// ── checks: what CI runs, plus the desktop shell and audits ────────────────────────────────────────────────
const checks = [];
const check = (name, cmd, skip) => {
  if (skip) { checks.push({ name, cmd, ok: null, secs: 0, log: skip }); return; }
  const r = sh(cmd);
  checks.push({ name, cmd, ok: r.ok, secs: r.secs, log: r.ok ? "" : tail(r.out, 80) });
};
check("Engine module builds (npm run build:wasm)", "npm run build:wasm");
rmSync("node_modules/.vitest-cache", { recursive: true, force: true });
check("Typecheck", "npx tsrs --noEmit");
check("Unit tests", "npx vitest run");
check("Site build", "npm run build");
check("Headless CLI build", "npm run build:cli");
check("Obsidian plugin build", "npm run plugin:build");
for (const d of CRATES.filter((c) => c.startsWith("crates/"))) {
  check(`${d}: clippy`, `cargo clippy --manifest-path ${d}/Cargo.toml --all-targets -- -D warnings`);
  check(`${d}: tests`, `cargo test --manifest-path ${d}/Cargo.toml`);
}
check("crates/solenoid-core: clippy (wasm)", "cargo clippy --manifest-path crates/solenoid-core/Cargo.toml --target wasm32-unknown-unknown -- -D warnings");
check("Desktop shell compiles (src-tauri)", "cargo check --manifest-path src-tauri/Cargo.toml",
  sh("pkg-config --exists webkit2gtk-4.1", { quiet: true }).ok ? "" : "skipped: no WebKitGTK dev libraries on this machine");

const audit = {};
try { audit.npm = JSON.parse(sh("npm audit --json", { quiet: true }).out).metadata?.vulnerabilities ?? null; } catch { audit.npm = null; }
if (has("cargo audit")) {
  try {
    audit.cargo = Object.fromEntries(CRATES.map((d) => {
      const j = JSON.parse(sh(`cargo audit --json --file ${d}/Cargo.lock`, { quiet: true }).out);
      return [d, (j.vulnerabilities?.list ?? []).map((v) => `${v.advisory.id} ${v.package.name} ${v.package.version}: ${v.advisory.title}`)];
    }));
  } catch { audit.cargo = null; }
}

// ── report ─────────────────────────────────────────────────────────────────────────────────────────────────
const toolchain = { node: must("node --version"), npm: must("npm --version"), rust: must("rustc --version") };
const date = new Date().toISOString().slice(0, 10);
const icon = (ok) => (ok === null ? "⏭️" : ok ? "✅" : "❌");
const failed = checks.filter((c) => c.ok === false);
const direct = changes.filter((c) => c.direct).sort((a, b) => Number(b.major) - Number(a.major) || a.name.localeCompare(b.name));
const transitive = changes.filter((c) => !c.direct);
const where = (c) => (c.eco === "npm" ? "npm" : c.where.replace("crates/", ""));
const md = [];
md.push(`# Bleeding edge, ${date}`, "");
md.push(`Every dependency at its newest release, on top of \`${base}\` @ \`${baseSha.slice(0, 9)}\`. Regenerated daily by \`.github/workflows/bleeding-edge.yml\`; never work on this branch. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).`, "");
md.push(`**${failed.length ? `${failed.length} of ${checks.filter((c) => c.ok !== null).length} checks fail` : "Every check passes"}.** ${direct.length} direct dependencies moved (${direct.filter((c) => c.major).length} across a major), ${transitive.length} transitive. ${toolchain.rust}, Node ${toolchain.node}.`, "");
if (peerNote) md.push(`> ${peerNote}`, "");
md.push("## Checks", "", "| | Check | Time |", "|---|---|---|");
for (const c of checks) md.push(`| ${icon(c.ok)} | ${c.name}${c.ok === null ? ` (${c.log})` : ""} | ${c.secs}s |`);
const badSetup = setup.filter((s) => !s.ok);
if (badSetup.length) { md.push("", "Setup steps that failed:", ""); for (const s of badSetup) md.push(`- ❌ ${s.name}`); }
md.push("", "## Direct dependencies that moved", "", "| | Package | Where | From | To | Notes |", "|---|---|---|---|---|---|");
for (const c of direct) md.push(`| ${c.major ? "⚠️ major" : ""} | \`${c.name}\` | ${where(c)} | ${c.from ?? "(new)"} | ${c.to ?? "(gone)"} | ${c.notes ? `[releases](${c.notes})` : ""} |`);
md.push("", `<details><summary>${transitive.length} transitive changes</summary>`, "", "| Package | Where | From | To |", "|---|---|---|---|");
for (const c of transitive.sort((a, b) => a.name.localeCompare(b.name))) md.push(`| \`${c.name}\`${c.major ? " ⚠️" : ""} | ${where(c)} | ${c.from ?? "(new)"} | ${c.to ?? "(gone)"} |`);
md.push("", "</details>", "", "## Security audits", "");
md.push(`- npm: ${audit.npm ? Object.entries(audit.npm).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "none" : "not run"}`);
if (audit.cargo) for (const [d, list] of Object.entries(audit.cargo)) md.push(`- ${d}: ${list.length ? list.join("; ") : "none"}`);
else md.push("- cargo: not run (cargo-audit not installed)");
if (failed.length || badSetup.length) {
  md.push("", "## Failure logs", "");
  for (const c of [...badSetup, ...failed]) md.push(`<details><summary>❌ ${c.name}</summary>`, "", `\`${c.cmd}\``, "", "```", c.log, "```", "", "</details>", "");
}
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/REPORT.md`, md.join("\n") + "\n");
writeFileSync(`${OUT}/REPORT.json`, JSON.stringify({ date, base, baseSha, toolchain, checks, setup, changes, audit }, null, 2) + "\n");
if (prevAnalysis.ok) writeFileSync(`${OUT}/ANALYSIS.md`, prevAnalysis.out);
console.log(`\n${OUT}/REPORT.md written: ${failed.length} failing checks, ${changes.length} changes`);

if (PUSH) {
  must("git add -A");
  must(`git -c user.name='solenoid-bleeding-edge' -c user.email='bleeding-edge@users.noreply.github.com' commit --quiet -m 'Bleeding edge ${date}: every dependency at its newest, on ${base}' -m '${failed.length} failing checks; see ${OUT}/REPORT.md.'`);
  must(`git push --force origin ${BRANCH}`);
  console.log(`pushed ${BRANCH}`);
}
