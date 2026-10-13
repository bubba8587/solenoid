// Snapshot the live app's canvas DOM + CSS into a static page (no React), at a given zoom.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [out, seed = "personal-finance", zoom = "0.1", expand = ""] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true, args: ["--no-sandbox", "--window-size=1600,1000"] });
const page = await b.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto("http://localhost:1420", { waitUntil: "networkidle2" });
await page.waitForSelector(".solenoid-node"); await sleep(3000);
await page.evaluate(async (id) => { const { clearAndLoadSeed } = await import("/src/graph/seeds.ts"); await clearAndLoadSeed(id); }, seed);
await sleep(5000);
if (expand) await page.evaluate(async () => {
  const { getEditor, getView } = await import("/src/graph/process.ts");
  const { setGroupsCollapsed } = await import("/src/graph/groupPush.ts");
  const { GroupNode } = await import("/src/graph/rete-nodes.ts");
  const ed = getEditor(), view = getView();
  await setGroupsCollapsed(ed, view, ed.getNodes().filter((n) => n instanceof GroupNode && n.collapsed), false);
});
await sleep(2500);
await page.evaluate(async (z) => {
  const { devRfStores } = await import("/src/graph/flow/devRfStores.ts");
  const st = [...devRfStores][0].getState();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of st.nodeLookup.values()) { if (n.hidden) continue; const p = n.internals.positionAbsolute; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + (n.measured?.width ?? 0)); y1 = Math.max(y1, p.y + (n.measured?.height ?? 0)); }
  await st.panZoom.setViewport({ x: st.width / 2 - ((x0 + x1) / 2) * z, y: st.height / 2 - ((y0 + y1) / 2) * z, zoom: z });
}, Number(zoom));
await sleep(1500);
const html = await page.evaluate(() => {
  const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const rf = document.querySelector(".react-flow").cloneNode(true);
  rf.querySelectorAll("canvas").forEach((c) => c.remove());
  return `<!doctype html><html class="${document.documentElement.className}" style="${document.documentElement.getAttribute("style") ?? ""}"><head><style>${css}</style></head><body class="${document.body.className}"><div style="position:fixed;inset:0">${rf.outerHTML}</div></body></html>`;
});
fs.writeFileSync(out, html);
console.log("snapshot", out, html.length, "bytes; cards", (html.match(/react-flow__node /g) || []).length);
await b.close();
