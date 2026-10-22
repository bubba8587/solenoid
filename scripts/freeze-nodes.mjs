// [[D99]] rustIsSpec
// Folds the card-body calls a `FREEZE_NODES=1` run recorded (.dev/node-calls/*.jsonl, tests/setup/nodeRecorder.ts)
// into fixtures/core/nodes/<Class>.json.gz, the answers the core's card bodies are held to. A call holding a value that
// can't cross yet is counted, not frozen.
//   node scripts/freeze-nodes.mjs                 every class recorded
//   node scripts/freeze-nodes.mjs ArithmeticNode  only these (the rest keep their bytes)
//   node scripts/freeze-nodes.mjs --report        what was recorded, written nowhere
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as readline from "node:readline";

const ROOT = path.resolve(import.meta.dirname, "..");
const CALLS = path.join(ROOT, ".dev/node-calls");
const OUT = path.join(ROOT, "fixtures/core/nodes");
const CAP = 2500;
const LAYOUT = new Set(["width", "height", "x", "y", "collapsed"]);

const args = process.argv.slice(2);
const reportOnly = args.includes("--report");
const only = new Set(args.filter((a) => !a.startsWith("--")));

const byKind = new Map();
for (const file of fs.readdirSync(CALLS).filter((f) => f.endsWith(".jsonl"))) {
  const lines = readline.createInterface({ input: fs.createReadStream(path.join(CALLS, file)), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const c = JSON.parse(line);
    // JSON.stringify escapes only a lone surrogate, which no UTF-8 reader takes: text the core never sees whole.
    if (/\\ud[89a-f][0-9a-f]{2}/i.test(line)) (c.uncrossable ??= []).push("lone surrogate");
    if (only.size && !only.has(c.kind)) continue;
    let k = byKind.get(c.kind);
    if (!k) byKind.set(c.kind, (k = { calls: 0, cases: new Map(), uncrossable: {}, thrownJs: 0, outRaw: 0, unstable: 0 }));
    k.calls++;
    if (c.uncrossable) {
      for (const u of new Set(c.uncrossable)) k.uncrossable[u] = (k.uncrossable[u] ?? 0) + 1;
      continue;
    }
    if (c.result.thrownJs) k.thrownJs++;
    if (c.result.outRaw !== undefined) k.outRaw++;
    for (const f of LAYOUT) delete c.init?.[f];
    const key = JSON.stringify([c.init, c.literals, c.stringLiterals, c.sockets, c.outputs, c.inputs, c.ctx.settings, c.prior]);
    const prev = k.cases.get(key);
    if (prev) {
      if (JSON.stringify([prev.result, prev.display]) !== JSON.stringify([c.result, c.display])) prev.unstable = true;
      continue;
    }
    k.cases.set(key, c);
  }
}

const report = {};
for (const [kind, k] of [...byKind].sort()) {
  let cases = [...k.cases.values()];
  const written = new Set(cases.flatMap((c) => Object.keys(c.display)));
  for (const c of cases) c.prior = Object.fromEntries(Object.entries(c.prior ?? {}).filter(([f]) => written.has(f)));
  const unstable = cases.filter((c) => c.unstable).length;
  if (cases.length > CAP) {
    const step = cases.length / CAP;
    cases = Array.from({ length: CAP }, (_, i) => cases[Math.floor(i * step)]);
  }
  report[kind] = { calls: k.calls, unique: k.cases.size, kept: cases.length, unstable, thrownJs: k.thrownJs, outRaw: k.outRaw, uncrossable: k.uncrossable };
  if (reportOnly) continue;
  fs.mkdirSync(OUT, { recursive: true });
  // Socket and input order is the card's (a row's place is its meaning), so they freeze as lists of pairs.
  const frozen = cases.map(({ kind: _k, unstable: u, sockets, outputs, inputs, ...c }) => ({
    ...c, sockets: Object.entries(sockets).map(([k, row]) => [k, ...row]),
    outputs: Object.entries(outputs).map(([k, row]) => [k, ...(Array.isArray(row) ? row : [row])]), inputs: Object.entries(inputs),
    ...(u ? { unstable: true } : {}),
  }));
  fs.writeFileSync(path.join(OUT, `${kind}.json.gz`), zlib.gzipSync(JSON.stringify(frozen), { level: 9 }));
}
fs.mkdirSync(path.join(ROOT, ".dev"), { recursive: true });
// Freezing some classes updates their rows and keeps the rest.
const reportFile = path.join(ROOT, ".dev/node-freeze-report.json");
const kept = only.size && fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : {};
fs.writeFileSync(reportFile, JSON.stringify({ ...kept, ...report }, null, 1));
const rows = Object.entries(report);
console.log(`${rows.length} classes, ${rows.reduce((s, [, r]) => s + r.kept, 0)} cases kept; report in .dev/node-freeze-report.json`);
