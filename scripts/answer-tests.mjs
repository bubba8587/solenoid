// [[D99]] rustIsSpec
// Finds the tests whose only subject is a card body's answer, which the frozen node fixtures hold once the calls are
// recorded and merged, and with --apply deletes them. A test counts when it calls a card's data() (or computeAlone/
// throughBoundary), names nothing else the app keeps in TypeScript (sockets, the engine, stores, saving, formulas,
// timers, mocks or a throw), and every card call it made is a frozen case answering as it saw: one too big to
// freeze, with an input that can't cross, drawn at random or never recorded keeps the test.
//   rm -rf .dev/node-calls && FREEZE_NODES=1 npx vitest run <files>    record, each call with the test that made it
//   node scripts/freeze-nodes.mjs --merge                                 fold them into the fixtures, then replay both
//   node scripts/answer-tests.mjs [--list] <test files>   what would go (--list: each test by name)
//   node scripts/answer-tests.mjs --apply <test files>    delete it, then what that leaves unused (scripts/fix-unused.mjs,
//                                                         which needs `npm i --no-save typescript`)
import fs from "node:fs";
import path from "node:path";
import { parseSync } from "rolldown/experimental";
import { spawnSync } from "node:child_process";
import { frozenForm, caseKey, readFixture } from "./node-cases.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const apply = process.argv.includes("--apply");
const list = process.argv.includes("--list");
// Only cards whose data() is their body on the core: a JavaScript card's test tests JavaScript.
const modRs = fs.readFileSync(path.join(ROOT, "crates/solenoid-core/src/nodes/mod.rs"), "utf8");
const DIRECT = new Set([...modRs.slice(modRs.indexOf("pub const DIRECT"), modRs.indexOf("];", modRs.indexOf("pub const DIRECT"))).matchAll(/"(\w+)"/g)].map((m) => m[1]));
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ANSWER = /\.data\(|computeAlone\(|throughBoundary\(/;
const OTHER = /addInput|removeInput|\.inputs\b|\.outputs\b|socket|Socket|extractInit|serializ|GraphEditor|DataflowEngine|engine\b|catalog|coreWatched|processGraph|Store\b|store\.|render|inEditor|cardPasses|persist|seed|readFileSync|wasmInvoke|frameBackend|nodeWire|compileEvaluator|compilePositional|evaluateOnCore|\.edited\(|toThrow|rejects|vi\.|spyOn|mock|setTimeout|new Promise|alert|valueKeys|addValue|addPair|valuePairKeys|keysDropped|setOp\(|setMode\(|\.op\s*=[^=]|\.mode\s*=[^=]|\.label\b/;

// Imported functions that only build or inspect a value. Any other imported function is a surface of its own (a
// formula, a verb, a parser) whose calls the node fixtures don't hold, so a test reaching one, itself or through a
// helper, stays.
const VALUE_ONLY = new Set(["isSolError", "solError", "cx", "isCx", "isUnitCell", "fromUnit", "withMatrixUnit", "matrixUnitOf",
  "tagFrameCellUnit", "columnUnitFromSpec", "fcUnitToUnit", "isFrameValue", "isCubeValue", "isChartValue", "isLambdaValue",
  "cubeFromColumns", "getColumn", "readFrame", "code"]);

// Each recorded test's calls, and whether the fixtures hold every one as it answered.
const CALLS = path.join(ROOT, ".dev/node-calls");
const callsOf = new Map();
for (const f of fs.existsSync(CALLS) ? fs.readdirSync(CALLS).filter((x) => x.endsWith(".jsonl")) : []) {
  for (const line of fs.readFileSync(path.join(CALLS, f), "utf8").split("\n")) {
    if (!line) continue;
    const c = JSON.parse(line);
    if (!c.at) continue;
    if (!callsOf.has(c.at)) callsOf.set(c.at, []);
    callsOf.get(c.at).push(c);
  }
}
if (!callsOf.size) { console.error("No recorded calls with their tests in .dev/node-calls: record first (see the top of this file)."); process.exit(1); }
const fixtures = new Map();
function fixture(kind) {
  if (!fixtures.has(kind)) {
    const file = path.join(ROOT, `fixtures/core/nodes/${kind}.json.gz`);
    fixtures.set(kind, DIRECT.has(kind) && fs.existsSync(file) ? new Map(readFixture(file).map((f) => [caseKey(f), f])) : null);
  }
  return fixtures.get(kind);
}
const frozenCall = (c) => {
  if (c.uncrossable || /\\ud[89a-f][0-9a-f]{2}/i.test(JSON.stringify(c))) return false;
  const f = fixture(c.kind)?.get(caseKey(frozenForm(structuredClone(c))));
  return !!f && !f.unstable && JSON.stringify(f.result) === JSON.stringify(c.result);
};
const held = (at) => (callsOf.get(at) ?? []).length > 0 && callsOf.get(at).every(frozenCall);

let total = 0, gone = 0;
const rows = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const { program, errors } = parseSync(f, src);
  if (errors.length) { rows.push([f, 0, 0, "unparsed"]); continue; }
  // Every card class the file names must be direct; the core's own replay harnesses and the benches aren't card tests.
  const classes = new Set([...src.matchAll(/\b([A-Z]\w*Node)\b/g)].map((m) => m[1]).filter((c) => !["GraphNode", "BaseNode"].includes(c)));
  const js = [...classes].filter((c) => !DIRECT.has(c));
  if (js.length || /\/core[A-Z]\w*\.test\.ts$|Bench\.test\.ts$/.test(f)) { rows.push([f, 0, 0, js.length ? `JS cards: ${js.slice(0, 3).join(" ")}` : "core harness or bench"]); continue; }
  const rel = path.relative(ROOT, path.resolve(f));
  // The file's own helpers and imported functions that reach past a card's answer.
  const helpers = new Map();
  const reaching = new Set();
  const decl = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(decl); return; }
    if (n.type === "ImportDeclaration" && n.importKind !== "type" && n.source.value !== "vitest") {
      for (const sp of n.specifiers) if (sp.importKind !== "type" && /^[a-z]/.test(sp.local.name) && !VALUE_ONLY.has(sp.local.name)) reaching.add(sp.local.name);
    }
    const fn = n.type === "FunctionDeclaration" ? [n.id?.name, n] : n.type === "VariableDeclarator" && n.id?.type === "Identifier" && /Function/.test(n.init?.type ?? "") ? [n.id.name, n.init] : null;
    if (fn?.[0]) helpers.set(fn[0], (helpers.get(fn[0]) ?? "") + src.slice(fn[1].start, fn[1].end));
    for (const k in n) if (k !== "parent") decl(n[k]);
  };
  decl(program);
  const named = (text, names) => [...names].some((x) => new RegExp(`(?<![\\w$.])${x.replace(/\$/g, "\\$")}\\b`).test(text));
  const elsewhere = (text) => OTHER.test(text) || /import\(\s*"(?![^"]*\/(nodes\/|nodeClasses))/.test(text);
  for (let grew = true; grew;) {
    grew = false;
    for (const [h, text] of helpers) if (!reaching.has(h) && (elsewhere(text) || named(text, reaching))) { reaching.add(h); grew = true; }
  }
  const name = (n) => (n?.type === "Literal" && typeof n.value === "string" ? n.value : n?.type === "TemplateLiteral" && !n.expressions.length ? n.quasis[0].value.cooked : null);
  const blocks = [];
  let unheld = 0;
  const walk = (n, chain) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, chain)); return; }
    if (n.type === "CallExpression" && n.callee?.type === "Identifier" && (n.callee.name === "it" || n.callee.name === "test")) {
      const body = src.slice(n.arguments[1]?.start ?? n.end, n.end);
      const own = name(n.arguments[0]);
      const answer = ANSWER.test(body) && !elsewhere(body) && !named(body, reaching);
      const frozen = answer && chain !== null && own !== null && held(`${rel} > ${[...chain, own].join(" > ")}`);
      if (answer && !frozen) unheld++;
      blocks.push({ start: n.start, end: n.end, answer: frozen });
      if (list && frozen) console.log(`  - ${rel} > ${[...chain, own].join(" > ")}`);
      return;
    }
    if (n.type === "CallExpression" && n.callee?.type === "Identifier" && n.callee.name === "describe") {
      const own = name(n.arguments[0]);
      walk(n.arguments, chain === null || own === null ? null : [...chain, own]);
      return;
    }
    for (const k in n) if (k !== "parent") walk(n[k], chain);
  };
  walk(program, []);
  const drop = blocks.filter((b) => b.answer);
  total += blocks.length; gone += drop.length;
  rows.push([f, blocks.length, drop.length, unheld ? `(${unheld} answer-only kept: a call not frozen)` : ""]);
  if (apply && drop.length) {
    let out = src;
    for (const b of drop.sort((x, y) => y.start - x.start)) {
      let s = b.start, e = b.end;
      if (out[e] === ";") e++;
      while (s > 0 && (out[s - 1] === " " || out[s - 1] === "\t")) s--;
      if (out[e] === "\n") e++;
      out = out.slice(0, s) + out.slice(e);
    }
    // A describe left with no test goes too, with the helpers it held; a file left with none goes whole.
    for (;;) {
      const tree = parseSync(f, out).program;
      const empty = [];
      let tests = 0;
      const scan = (n, inDescribe) => {
        if (!n || typeof n !== "object") return 0;
        if (Array.isArray(n)) return n.reduce((s, x) => s + scan(x, inDescribe), 0);
        if (n.type === "CallExpression" && n.callee?.type === "Identifier" && (n.callee.name === "it" || n.callee.name === "test")) return 1;
        if (n.type === "CallExpression" && n.callee?.type === "Identifier" && n.callee.name === "describe") {
          const inner = scan(n.arguments, true);
          if (inner === 0) empty.push(n);
          return inner;
        }
        let c = 0;
        for (const k in n) if (k !== "parent") c += scan(n[k], inDescribe);
        return c;
      };
      tests = scan(tree, false);
      if (tests === 0) { fs.rmSync(f); break; }
      if (!empty.length) { fs.writeFileSync(f, out); break; }
      for (const b of empty.sort((x, y) => y.start - x.start)) {
        let s0 = b.start, e = b.end;
        if (out[e] === ";") e++;
        while (s0 > 0 && (out[s0 - 1] === " " || out[s0 - 1] === "\t")) s0--;
        if (out[e] === "\n") e++;
        out = out.slice(0, s0) + out.slice(e);
      }
    }
  }
}
if (apply) {
  const cut = rows.filter((r) => r[2] && fs.existsSync(r[0])).map((r) => r[0]);
  if (cut.length) spawnSync("node", [new URL("./fix-unused.mjs", import.meta.url).pathname, ...cut], { stdio: "inherit" });
}
for (const [f, n, d, note] of rows.filter((r) => r[2] || r[3]).sort((x, y) => y[2] - x[2])) console.log(`${String(d).padStart(4)}/${String(n).padEnd(4)} ${f}${note ? " " + note : ""}`);
console.log(`${apply ? "deleted" : "would delete"} ${gone} of ${total} tests in ${files.length} files`);
