// Keeps the `bleeding-edge` branch: the most recently pushed work branch with every dependency at its newest version,
// majors included, the newest web-platform features tried out, and a report of what broke (.github/bleeding-edge/
// REPORT.md and REPORT.json). The branch is persistent. Each run rebases its own commits (earlier dependency bumps,
// fixes, experiments, the weekly ANALYSIS.md) from the base commit it was last built on onto the newest base, so no
// bump is ever redone, then bumps only what is newer still, runs the checks and replaces the report commit on top.
// A carried commit that conflicts with new work anywhere but a manifest or lockfile is dropped and named in the
// report; the pre-rebase tip is kept on `bleeding-edge-prev`, so a dropped experiment can be redone from it.
//
//   node .github/bleeding-edge/bleeding-edge.mjs [--push] [--base <branch>] [--rebase-only]
//
// --rebase-only stops after the rebase and prints what was carried and dropped (no installs, checks or push).
//
// Self-contained (no repo imports), so the workflow can run it from a copy while the base branch is checked out.
// Needs on PATH: node/npm, cargo with clippy and the wasm32 target, cargo-upgrade (cargo-edit). Optional:
// cargo-binstall (fast wasm-bindgen-cli install), cargo-audit, WebKitGTK dev libraries (the desktop check).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const PUSH = args.includes("--push");
const BRANCH = "bleeding-edge";
const BACKUP = "bleeding-edge-prev";
const REBASE_ONLY = args.includes("--rebase-only");
const BOT = "-c user.name='solenoid-bleeding-edge' -c user.email='bleeding-edge@users.noreply.github.com'";
const REPORT_SUBJECT = "Bleeding edge report";
// Files a dependency bump touches. On a rebase conflict in these alone, package.json merges (the base's file, each
// dependency both sides list at the newer of the two versions); the others take the base's copy, which the install and
// `cargo upgrade` below bring forward again.
const DEP_FILE = /(^|\/)(package\.json|package-lock\.json|Cargo\.toml|Cargo\.lock)$/;
const OUT = ".github/bleeding-edge";
const ALL_CRATES = ["crates/solenoid-core", "crates/solenoid-graph", "crates/solenoid-parquet", "crates/solenoid-schedule", "src-tauri"];
// Branches that aren't where work happens: production (it only takes releases), this one, session and bot branches.
const NOT_WORK = /^(main$|master$|bleeding-edge$|bleeding-edge-prev$|ccr-|claude\/|vercel\/|dependabot\/|renovate\/)/;

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

// ── pick the base and rebase the branch onto it ─────────────────────────────────────────────────────────────
must("git fetch --quiet origin '+refs/heads/*:refs/remotes/origin/*'");
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]
  : must("git for-each-ref --sort=-committerdate --format='%(refname:lstrip=3)' refs/remotes/origin").split("\n").find((b) => b !== "HEAD" && !NOT_WORK.test(b));
const baseSha = must(`git rev-parse origin/${base}`);
const subjectOf = (rev) => must(`git log -1 --format=%s ${rev}`);
const versionKey = (range) => (String(range).match(/\d+(\.\d+){0,2}/)?.[0] ?? "0").split(".").map(Number);
const newer = (a, b) => { const [x, y] = [versionKey(a), versionKey(b)]; for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? a : b; return a; };
function mergePackageJson(file) {
  const ours = JSON.parse(must(`git show :2:'${file}'`));
  const theirs = JSON.parse(must(`git show :3:'${file}'`));
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, v] of Object.entries(ours[key] ?? {})) if (theirs[key]?.[name]) ours[key][name] = newer(theirs[key][name], v);
  }
  writeFileSync(file, JSON.stringify(ours, null, 2) + "\n");
}
const exists = sh(`git rev-parse --verify --quiet origin/${BRANCH}`, { quiet: true }).ok;
const oldTip = exists ? must(`git rev-parse origin/${BRANCH}`) : null;
let prev = null;
try { prev = JSON.parse(must(`git show origin/${BRANCH}:${OUT}/REPORT.json`)); } catch { /* first run, or a branch without a report */ }

const carried = [];
const dropped = [];
const renumbered = [];
const DECISIONS = "tree/decisions";
const LEAF = /^tree\/decisions\/([A-Z])\/\1(\d+)\.md$/;
const uuidOf = (text) => text?.match(/^uuid:\s*(\S+)/m)?.[1] ?? null;
const atRev = (rev, path) => { const r = sh(`git show '${rev}:${path}'`, { quiet: true }); return r.ok ? r.out : null; };
let fromSha = null;
if (!exists) {
  must(`git checkout --quiet -B ${BRANCH} origin/${base}`);
} else {
  must(`git checkout --quiet -B ${BRANCH} origin/${BRANCH}`);
  // The report commit is rewritten every run, so the old one never travels.
  if (subjectOf("HEAD").startsWith(REPORT_SUBJECT)) must("git reset --quiet --hard HEAD~1");
  // Rebase from the newest base commit the branch already holds: the merge-base with the base, unless the base branch
  // changed since the last report (the recorded base commit isn't under the merge-base), when the recorded one marks
  // where this branch's own commits start, so it carries only those.
  const mergeBase = must(`git merge-base HEAD origin/${base}`);
  const recorded = prev?.baseSha && sh(`git merge-base --is-ancestor ${prev.baseSha} HEAD`, { quiet: true }).ok ? prev.baseSha : null;
  fromSha = !recorded || sh(`git merge-base --is-ancestor ${recorded} ${mergeBase}`, { quiet: true }).ok ? mergeBase : recorded;
  const inProgress = () => ["rebase-merge", "rebase-apply"].some((d) => existsSync(must(`git rev-parse --git-path ${d}`)));
  // A leaf this branch added whose id the new base also uses for a different leaf (another uuid, or none) would
  // collide. On the branch's old base that id doesn't exist yet, so every mention of it on the branch means the
  // branch's leaf: replay the branch onto its old base with each such leaf moved to a free id and its citations
  // rewritten, and the rebase below meets no collision.
  const usedIds = new Set();
  for (const rev of ["HEAD", `origin/${base}`]) {
    for (const f of must(`git ls-tree -r --name-only ${rev} -- ${DECISIONS}`).split("\n")) { const m = f.match(LEAF); if (m) usedIds.add(m[1] + m[2]); }
    for (const line of (atRev(rev, `${DECISIONS}/RETIRED`) ?? "").split("\n")) { const id = line.split("\t")[0]; if (/^[A-Z]\d+$/.test(id)) usedIds.add(id); }
  }
  const nextFree = (ring) => { let n = 1; for (const id of usedIds) if (id[0] === ring) n = Math.max(n, Number(id.slice(1)) + 1); usedIds.add(ring + n); return ring + n; };
  const mapping = [];
  for (const f of must(`git diff --name-only --diff-filter=A ${fromSha} HEAD -- ${DECISIONS}`).split("\n")) {
    const m = f.match(LEAF);
    if (!m) continue;
    const theirs = atRev(`origin/${base}`, f);
    if (theirs === null) continue;
    const mine = atRev("HEAD", f);
    if (uuidOf(theirs) && uuidOf(theirs) === uuidOf(mine)) continue;   // the same leaf: an ordinary conflict, if any
    const from = m[1] + m[2];
    const to = nextFree(m[1]);
    const name = mine.match(/^aliases:\s*\[?\s*-?\s*([A-Za-z][A-Za-z0-9]*)/m)?.[1] ?? mine.match(/^aliases:\s*\n\s*-\s*(\S+)/m)?.[1] ?? null;
    mapping.push({ from, to, ring: m[1], uuid: uuidOf(mine), name });
    renumbered.push({ from, to, name, because: uuidOf(theirs) ? "the base's has another uuid" : "the base's has no uuid" });
  }
  if (mapping.length) {
    const script = join(tmpdir(), `bleeding-edge-renumber-${process.pid}.mjs`);
    writeFileSync(script, `import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const mapping = ${JSON.stringify(mapping)};
const run = (c) => execSync(c, { encoding: "utf8" });
for (const { from, to, ring, uuid, name } of mapping) {
  const oldPath = "${DECISIONS}/" + ring + "/" + from + ".md", newPath = "${DECISIONS}/" + ring + "/" + to + ".md";
  if (existsSync(oldPath) && (readFileSync(oldPath, "utf8").match(/^uuid:\\s*(\\S+)/m)?.[1] ?? null) === uuid) {
    run("git mv '" + oldPath + "' '" + newPath + "'");
    writeFileSync(newPath, readFileSync(newPath, "utf8").replace(new RegExp("^id: " + from + "$", "m"), "id: " + to));
  }
  const files = run("git grep -lwE '" + from + "' || true").split("\\n").filter(Boolean);
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    let u = t.split("[[" + from + "]]").join("[[" + to + "]]").split("[[" + from + "|").join("[[" + to + "|")
      .replace(/dte:[A-Z0-9,]+/g, (m) => m.replace(new RegExp("\\\\b" + from + "\\\\b", "g"), to));
    if (name) u = u.split(from + " " + name).join(to + " " + name);
    if (u !== t) writeFileSync(f, u);
  }
}
run("git add -A");
if (run("git status --porcelain").trim()) run("git ${BOT} commit --quiet --amend --no-edit");
`);
    const r0 = sh(`GIT_EDITOR=true git ${BOT} rebase --force-rebase --exec 'node ${script}' ${fromSha}`);
    rmSync(script, { force: true });
    if (!r0.ok) throw new Error(`renumbering the branch's colliding leaves failed:\n${r0.out}`);
  }
  let r = sh(`GIT_EDITOR=true git ${BOT} rebase --empty=drop --onto origin/${base} ${fromSha}`);
  while (!r.ok && inProgress()) {
    const sha = must("git rev-parse REBASE_HEAD");
    const files = must("git diff --name-only --diff-filter=U").split("\n").filter(Boolean);
    if (files.length && files.every((f) => DEP_FILE.test(f))) {
      for (const f of files) {
        if (/(^|\/)package\.json$/.test(f)) mergePackageJson(f);
        else must(`git checkout --ours -- '${f}'`);
      }
      must(`git add -- ${files.map((f) => `'${f}'`).join(" ")}`);
      r = sh(`GIT_EDITOR=true git ${BOT} rebase --continue`);
      if (!r.ok && /No changes|nothing to commit/i.test(r.out)) r = sh(`GIT_EDITOR=true git ${BOT} rebase --skip`);
    } else {
      dropped.push({ sha, subject: subjectOf(sha), files });
      r = sh(`GIT_EDITOR=true git ${BOT} rebase --skip`);
    }
  }
  if (!r.ok) throw new Error(`rebase failed outside a conflict:\n${r.out}`);
  // What landed, read back from the result: a commit the conflict resolution emptied is gone and isn't counted.
  for (const sha of must(`git rev-list --reverse origin/${base}..HEAD`).split("\n").filter(Boolean)) carried.push({ sha, subject: subjectOf(sha) });
}
console.log(`base: ${base} @ ${baseSha.slice(0, 9)}${fromSha ? `, rebased from ${fromSha.slice(0, 9)}` : ", new branch"}; ${carried.length} commits carried, ${dropped.length} dropped, ${renumbered.length} leaves renumbered`);
for (const r of renumbered) console.log(`  renumbered ${r.from} -> ${r.to}${r.name ? ` ${r.name}` : ""} (${r.because})`);
for (const d of dropped) console.log(`  dropped ${d.sha.slice(0, 9)} ${d.subject} (${d.files.join(", ")})`);
if (REBASE_ONLY) process.exit(0);
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
// The base's own direct versions, for how far the branch now sits ahead of it.
const atBase = (path) => { const r = sh(`git show origin/${base}:${path}`, { quiet: true }); return r.ok ? r.out : null; };
const baseNpmDirect = (() => { const t = atBase("package.json"); if (!t) return new Map(); const pkg = JSON.parse(t); return new Map(Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })); })();

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
const date = new Date().toISOString().slice(0, 10);
// Only what moved today becomes a commit; an unchanged day adds none.
sh(`git add -- package.json package-lock.json ${CRATES.map((d) => `${d}/Cargo.toml ${d}/Cargo.lock`).join(" ")}`, { quiet: true });
const bumped = !sh("git diff --cached --quiet", { quiet: true }).ok;
if (bumped) must(`git ${BOT} commit --quiet -m 'Bleeding edge ${date}: dependencies to their newest'`);

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
const icon = (ok) => (ok === null ? "⏭️" : ok ? "✅" : "❌");
const failed = checks.filter((c) => c.ok === false);
const direct = changes.filter((c) => c.direct).sort((a, b) => Number(b.major) - Number(a.major) || a.name.localeCompare(b.name));
const transitive = changes.filter((c) => !c.direct);
const where = (c) => (c.eco === "npm" ? "npm" : c.where.replace("crates/", ""));
const md = [];
md.push(`# Bleeding edge, ${date}`, "");
md.push(`Every dependency at its newest release and the newest platform features tried out, rebased onto \`${base}\` @ \`${baseSha.slice(0, 9)}\` by \`.github/workflows/bleeding-edge.yml\`. The branch keeps its own commits across runs: dependency bumps, fixes and experiments made here ride along on every rebase. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).`, "");
md.push(`**${failed.length ? `${failed.length} of ${checks.filter((c) => c.ok !== null).length} checks fail` : "Every check passes"}.** Today ${direct.length} direct dependencies moved (${direct.filter((c) => c.major).length} across a major), ${transitive.length} transitive. ${toolchain.rust}, Node ${toolchain.node}.`, "");
md.push("## This branch on its base", "");
md.push(fromSha ? `Rebased from \`${fromSha.slice(0, 9)}\` onto \`${base}\` @ \`${baseSha.slice(0, 9)}\`: ${carried.length} commits carried${bumped ? ", one bump added" : ", no new bump"}.` : `A new branch on \`${base}\` @ \`${baseSha.slice(0, 9)}\`.`, "");
for (const c of carried) md.push(`- \`${c.sha.slice(0, 9)}\` ${c.subject}`);
if (renumbered.length) {
  md.push("", `**Renumbered: ${renumbered.length} of this branch's leaves** took ids the base had given to other leaves (told apart by their uuids); each moved to a free id, its citations with it.`, "");
  for (const r of renumbered) md.push(`- ${r.from} → ${r.to}${r.name ? ` ${r.name}` : ""} (${r.because})`);
}
if (dropped.length) {
  md.push("", `**Dropped: ${dropped.length} commits conflicted with new work** outside the dependency files. Each is still on \`${BACKUP}\`; redo it on top of this branch if it's still wanted.`, "");
  for (const d of dropped) md.push(`- ❌ \`${d.sha.slice(0, 9)}\` ${d.subject} (conflicts in ${d.files.map((f) => `\`${f}\``).join(", ")})`);
}
const ahead = [...after.npmDirect].filter(([name, v]) => baseNpmDirect.get(name) !== v);
md.push("", `<details><summary>${ahead.length} npm direct dependencies ahead of ${base}</summary>`, "", "| Package | On base | Here |", "|---|---|---|");
for (const [name, v] of ahead.sort(([a], [b]) => a.localeCompare(b))) md.push(`| \`${name}\` | ${baseNpmDirect.get(name) ?? "(none)"} | ${v} |`);
md.push("", "</details>", "");
if (peerNote) md.push(`> ${peerNote}`, "");
md.push("## Checks", "", "| | Check | Time |", "|---|---|---|");
for (const c of checks) md.push(`| ${icon(c.ok)} | ${c.name}${c.ok === null ? ` (${c.log})` : ""} | ${c.secs}s |`);
const badSetup = setup.filter((s) => !s.ok);
if (badSetup.length) { md.push("", "Setup steps that failed:", ""); for (const s of badSetup) md.push(`- ❌ ${s.name}`); }
md.push("", "## Direct dependencies that moved today", "", "| | Package | Where | From | To | Notes |", "|---|---|---|---|---|---|");
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
writeFileSync(`${OUT}/REPORT.json`, JSON.stringify({ date, base, baseSha, fromSha, carried, dropped, renumbered, bumped, toolchain, checks, setup, changes, audit }, null, 2) + "\n");
console.log(`\n${OUT}/REPORT.md written: ${failed.length} failing checks, ${changes.length} changes`);

must(`git add -- ${OUT}/REPORT.md ${OUT}/REPORT.json`);
must(`git ${BOT} commit --quiet -m '${REPORT_SUBJECT} ${date}: ${failed.length} failing checks, on ${base}' -m 'See ${OUT}/REPORT.md.'`);
if (PUSH) {
  // A rebase rewrites the branch, so the push forces; the lease refuses if someone pushed to it during the run.
  if (dropped.length && oldTip) must(`git push --force origin ${oldTip}:refs/heads/${BACKUP}`);
  must(`git push ${oldTip ? `--force-with-lease=${BRANCH}:${oldTip}` : ""} origin ${BRANCH}`);
  console.log(`pushed ${BRANCH}`);
}
