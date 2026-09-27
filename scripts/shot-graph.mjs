// Loads a graph into the live app and screenshots it, for seeing a change on a real canvas.
// Starts the dev server if it is down. The graph opens as the only document of a fresh profile.
//   node scripts/shot-graph.mjs <graph.json> [--out file.png] [--popup [N]] [--click <css>]… [--wait ms] [--full]
// The graph is a saved graph (`.dev/current-graph.json` works as is) or the short form:
//   { "nodes": [ { "id": "l1", "type": "LambdaNode", "init": { "params": "", "expr": "@x * 2" } },
//                { "id": "f1", "type": "FrameInputNode", "lambdaKeys": ["fn1"],
//                  "frame": [ { "name": "x", "cells": [1, 2, 3] }, { "name": "y", "expr": "λ1" } ] } ],
//     "cables": [ "l1.result -> f1.fn1" ] }
// A node without x/y is placed by its depth in the cable graph. `frame` builds a Frame Input's frameText
// (a column's type is inferred from its cells unless given). Prints every node's text; the app re-ids
// nodes on load, so each line starts with the node's title. Examples to copy: scripts/shot-graphs/.
// --popup opens the Nth frame chip's table (1 by default) and shoots that instead of the canvas.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const argv = process.argv.slice(2);
const opt = { out: join(tmpdir(), "solenoid-shot.png"), clicks: [], wait: 1500, popup: 0, full: false, file: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out") opt.out = argv[++i];
  else if (a === "--click") opt.clicks.push(argv[++i]);
  else if (a === "--wait") opt.wait = Number(argv[++i]);
  else if (a === "--full") opt.full = true;
  else if (a === "--popup") opt.popup = /^\d+$/.test(argv[i + 1] ?? "") ? Number(argv[++i]) : 1;
  else opt.file = a;
}
if (!opt.file) { console.error("usage: node scripts/shot-graph.mjs <graph.json> [--out file.png] [--popup [N]] [--click css]… [--wait ms] [--full]"); process.exit(2); }

const inferType = (cells) => {
  const filled = cells.filter((c) => c !== "" && c != null);
  if (filled.length && filled.every((c) => !Number.isNaN(Number(c)))) return "number";
  if (filled.length && filled.every((c) => /^(true|false)$/i.test(String(c)))) return "logical";
  return "string";
};

function expand(raw) {
  const g = raw.graph ?? raw;
  const nodes = g.nodes.map((n) => {
    const { frame, lambdaKeys, ...rest } = n;
    const init = { ...(rest.init ?? {}) };
    if (frame) {
      init.frameText = JSON.stringify(frame.map((c) => {
        const cells = (c.cells ?? []).map(String);
        return { name: c.name, type: c.type ?? (c.expr ? "number" : inferType(cells)), cells, ...(c.unit ? { unit: c.unit } : {}), ...(c.expr ? { expr: c.expr } : {}) };
      }));
    }
    if (lambdaKeys) init.lambdaKeys = lambdaKeys;
    return { ...rest, init };
  });
  const connections = [...(g.connections ?? []), ...(g.cables ?? []).map((s) => {
    const m = /^\s*([^.\s]+)\.(\S+)\s*->\s*([^.\s]+)\.(\S+)\s*$/.exec(s);
    if (!m) throw new Error(`bad cable "${s}", want "src.output -> dst.input"`);
    return { source: m[1], sourceOutput: m[2], target: m[3], targetInput: m[4] };
  })];
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const c of connections) depth.set(c.target, Math.max(depth.get(c.target) ?? 0, (depth.get(c.source) ?? 0) + 1));
  }
  const perCol = new Map();
  for (const n of nodes) {
    if (n.x != null && n.y != null) continue;
    const d = depth.get(n.id) ?? 0;
    const row = perCol.get(d) ?? 0;
    perCol.set(d, row + 1);
    n.x = d * 460;
    n.y = row * 360;
  }
  return { ...g, v: g.v ?? 2, nodes, connections };
}

const graph = expand(JSON.parse(readFileSync(opt.file, "utf8")));
execFileSync(process.execPath, [new URL("./dev-up.mjs", import.meta.url).pathname], { stdio: "inherit" });

const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") console.log(`[console.error] ${m.text()}`); });
  const doc = { id: "shot", name: graph.label ?? "Shot", graph, updatedAt: Date.now() };
  await page.evaluateOnNewDocument((doc) => {
    if (sessionStorage.getItem("shot-seeded")) return;
    sessionStorage.setItem("shot-seeded", "1");
    localStorage.clear();
    localStorage.setItem("solenoid.docs.index.a", JSON.stringify({ seq: 1, currentId: doc.id, docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }] }));
    localStorage.setItem(`solenoid.docs.doc.${doc.id}.a`, JSON.stringify({ seq: 2, doc }));
  }, doc);
  await page.goto("http://localhost:1420", { waitUntil: "networkidle2", timeout: 90_000 });
  await page.waitForSelector(".solenoid-node", { timeout: 30_000 });
  await page.click(".solenoid-nav__btn--fit").catch(() => {});
  await new Promise((r) => setTimeout(r, opt.wait));

  const texts = await page.evaluate(() => [...document.querySelectorAll(".react-flow__node")]
    .map((n) => (n.innerText ?? "").replace(/\s*\n\s*/g, " | ").slice(0, 600)));
  for (const t of texts) console.log(t);

  for (const sel of opt.clicks) {
    await page.click(sel);
    await new Promise((r) => setTimeout(r, 600));
  }
  let clip;
  if (opt.popup) {
    const chips = await page.$$(".solenoid-array-chip--frame");
    if (!chips[opt.popup - 1]) throw new Error(`no frame chip #${opt.popup} (found ${chips.length})`);
    await chips[opt.popup - 1].click();
    await new Promise((r) => setTimeout(r, 1000));
    clip = await page.evaluate(() => {
      const p = document.querySelector(".table-popup");
      const r = p?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    });
  } else if (!opt.full) {
    clip = await page.evaluate(() => {
      const rs = [...document.querySelectorAll(".react-flow__node")].map((n) => n.getBoundingClientRect());
      if (!rs.length) return null;
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 24), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 24);
      const w = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 24) - x;
      const h = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 24) - y;
      return { x, y, width: w, height: h };
    });
  }
  await page.screenshot({ path: opt.out, ...(clip ? { clip } : {}) });
  console.log(`saved ${opt.out}`);
} finally {
  await browser.close();
}
