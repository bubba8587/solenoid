// [[D99]] rustIsSpec
// Finds the tests whose only subject is a card body's answer, which the frozen node fixtures hold once the calls are
// recorded and merged (`FREEZE_NODES=1 npx vitest run <files>`, `node scripts/freeze-nodes.mjs --merge`), and with
// --apply deletes them. A test counts when it calls a card's data() (or computeAlone/throughBoundary) and names
// nothing else the app keeps in TypeScript: sockets, the engine, stores, saving, formulas, timers, mocks or a throw.
//   node scripts/answer-tests.mjs <test files>            what would go
//   node scripts/answer-tests.mjs --apply <test files>    delete it, then what that leaves unused (scripts/fix-unused.mjs,
//                                                         which needs `npm i --no-save typescript`)
import fs from "node:fs";
import { parseSync } from "rolldown/experimental";
import { spawnSync } from "node:child_process";

const apply = process.argv.includes("--apply");
// Only cards whose data() is their body on the core: a JavaScript card's test tests JavaScript.
const modRs = fs.readFileSync(new URL("../crates/solenoid-core/src/nodes/mod.rs", import.meta.url), "utf8");
const KEEP = new Set((process.env.KEEP ?? "").split(",").filter(Boolean));
const DIRECT = new Set([...modRs.slice(modRs.indexOf("pub const DIRECT"), modRs.indexOf("];", modRs.indexOf("pub const DIRECT"))).matchAll(/"(\w+)"/g)].map((m) => m[1]));
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ANSWER = /\.data\(|computeAlone\(|throughBoundary\(/;
const OTHER = /addInput|removeInput|\.inputs\b|\.outputs\b|socket|Socket|extractInit|serializ|GraphEditor|DataflowEngine|engine\b|catalog|coreWatched|processGraph|Store\b|store\.|render|inEditor|cardPasses|persist|seed|readFileSync|wasmInvoke|frameBackend|nodeWire|compileEvaluator|compilePositional|evaluateOnCore|\.edited\(|toThrow|rejects|vi\.|spyOn|mock|setTimeout|new Promise|alert|valueKeys|addValue|addPair|valuePairKeys|keysDropped|setOp\(|setMode\(|\.op\s*=[^=]|\.mode\s*=[^=]|\.label\b/;

let total = 0, gone = 0;
const rows = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const { program, errors } = parseSync(f, src);
  if (errors.length) { rows.push([f, 0, 0, "unparsed"]); continue; }
  // Every card class the file names must be direct, and the core's own replay harnesses aren't card tests.
  const classes = new Set([...src.matchAll(/\b([A-Z]\w*Node)\b/g)].map((m) => m[1]).filter((c) => !["GraphNode", "BaseNode"].includes(c)));
  // ...and frozen: a card with no fixture, or one named in KEEP (calls that didn't freeze: too big, a draw, an undefined
  // input), keeps its tests.
  const js = [...classes].filter((c) => !DIRECT.has(c) || !fs.existsSync(new URL(`../fixtures/core/nodes/${c}.json.gz`, import.meta.url)) || KEEP.has(c));
  if (js.length || /\/core[A-Z]\w*\.test\.ts$/.test(f)) { rows.push([f, 0, 0, js.length ? `JS cards: ${js.slice(0, 3).join(" ")}` : "core harness"]); continue; }
  const blocks = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "CallExpression" && n.callee?.type === "Identifier" && (n.callee.name === "it" || n.callee.name === "test")) {
      const body = src.slice(n.arguments[1]?.start ?? n.end, n.end);
      blocks.push({ start: n.start, end: n.end, answer: ANSWER.test(body) && !OTHER.test(body) });
      return;
    }
    for (const k in n) if (k !== "parent") walk(n[k]);
  };
  walk(program);
  const drop = blocks.filter((b) => b.answer);
  total += blocks.length; gone += drop.length;
  rows.push([f, blocks.length, drop.length]);
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
