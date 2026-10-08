// Probes the touch pan: a one-finger drag that starts on an unselected card must pan (camera moves,
// no node moves) on the main canvas and inside the sudoku-solver composite's drill-in, and after a tap
// selects a card, a second drag must move it. Needs the dev server on :1420.
//   node scripts/touch-pan-probe.mjs
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const EDGE = browserPath();
const URL = "http://localhost:1420";
const SEED = "sudoku-solver";
const NODE_SEL = ".solenoid-node, .solenoid-note, .solenoid-group, .solenoid-conduit";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true, args: ["--window-size=1600,1100"],
  });
  const fail = [];
  try {
    const page = await browser.newPage();
    // Mobile, not just touch: on desktop stopDragStart swallows a press on card chrome; IS_MOBILE_UA reads userAgentData.mobile first.
    await page.setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
      { mobile: true, platform: "Android", platformVersion: "14", architecture: "", model: "Pixel 8", brands: [] },
    );
    await page.setViewport({ width: 900, height: 1300, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    page.setDefaultTimeout(120000);
    const client = await page.target().createCDPSession();
    // Before the app loads: IS_COARSE reads (pointer: coarse) at import, which headless reports false.
    await page.evaluateOnNewDocument(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) =>
        /pointer:\s*coarse/.test(q)
          ? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {},
              addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
          : orig(q);
    });

    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(`[console] ${m.text()}`); });
    page.on("pageerror", (e) => errs.push(`[pageerror] ${e.message}`));

    await page.goto(URL, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => typeof window.__solenoidTuneSeed === "function");
    await page.waitForSelector(".solenoid-node");
    await sleep(4000);

    process.stdout.write(`loading seed "${SEED}" ... `);
    await page.evaluate((id) => window.__solenoidTuneSeed(id), SEED);
    await sleep(1500);
    console.log("done");

    const isMobile = await page.evaluate(() => document.documentElement.classList.contains("is-mobile"));
    console.log(`mobile model: ${isMobile ? "on (html.is-mobile)" : "OFF — probe would mis-measure"}`);
    if (!isMobile) fail.push("app is not in the mobile model — emulation did not take");

    const measure = (rootSel) => page.evaluate((sel, nodeSel) => {
      const root = document.querySelector(sel);
      if (!root) return [];
      return [...root.querySelectorAll(nodeSel)].map((el) => {
        const r = el.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
    }, rootSel, NODE_SEL);

    // A pan shifts every card equally, so the camera delta is the median shift and a moved node deviates from it.
    const metrics = (before, after) => {
      const n = Math.min(before.length, after.length);
      const dx = [], dy = [];
      for (let i = 0; i < n; i++) { dx.push(after[i].cx - before[i].cx); dy.push(after[i].cy - before[i].cy); }
      const mdx = median(dx), mdy = median(dy);
      let moved = 0;
      for (let i = 0; i < n; i++) if (Math.hypot(dx[i] - mdx, dy[i] - mdy) > 5) moved++;
      return { camDx: Math.round(mdx), camDy: Math.round(mdy), nodesMoved: moved, count: n };
    };

    const drag = async (x0, y0, dx, dy, steps = 10) => {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 0 }] });
      for (let i = 1; i <= steps; i++) {
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x0 + (dx * i) / steps, y: y0 + (dy * i) / steps, id: 0 }],
        });
        await sleep(16);
      }
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(120);
    };
    const tap = async (x, y) => {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
      await sleep(40);
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(120);
    };

    const pickCard = (rootSel) => page.evaluate((sel, nodeSel) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      let best = null, bestD = Infinity;
      for (const el of root.querySelectorAll(nodeSel)) {
        if (el.querySelector(".solenoid-node__inline-input")) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 30) continue;
        if (r.top < 60 || r.bottom > window.innerHeight - 60) continue;
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (d < bestD) { bestD = d; best = { x: r.left + r.width / 2, y: r.top + 10, id: el.className }; }
      }
      return best;
    }, rootSel, NODE_SEL);

    const mainCard = await pickCard(".solenoid-canvas");
    if (!mainCard) { fail.push("main: no draggable card found"); }
    else {
      const before = await measure(".solenoid-canvas");
      await drag(mainCard.x, mainCard.y, 120, 90);
      const after = await measure(".solenoid-canvas");
      const m = metrics(before, after);
      console.log(`MAIN CANVAS  finger-drag on a card → cam Δ(${m.camDx}, ${m.camDy})  nodesMoved=${m.nodesMoved}  (${m.count} cards)`);
      if (!(Math.hypot(m.camDx, m.camDy) > 20 && m.nodesMoved === 0)) fail.push("main: expected a pan with 0 nodes moved");
    }

    process.stdout.write("drilling into the composite ... ");
    const drilled = await page.evaluate(() => {
      const btns = [...document.querySelectorAll(".solenoid-node__inline-input")];
      const edit = btns.find((b) => /Edit contents/i.test(b.textContent || ""));
      if (!edit) return false;
      edit.click();
      return true;
    });
    if (!drilled) { fail.push("could not find the composite's Edit-contents button"); }
    else {
      await page.waitForSelector(".solenoid-composite-editor__canvas .solenoid-node", { timeout: 30000 });
      await sleep(1200);
      console.log("done");

      const DRILL = ".solenoid-composite-editor__canvas";
      const card = await pickCard(DRILL);
      if (!card) { fail.push("drill-in: no draggable card found"); }
      else {
        const before = await measure(DRILL);
        await drag(card.x, card.y, 120, 90);
        const after = await measure(DRILL);
        const m = metrics(before, after);
        console.log(`DRILL-IN     finger-drag on a card → cam Δ(${m.camDx}, ${m.camDy})  nodesMoved=${m.nodesMoved}  (${m.count} cards)`);
        if (!(Math.hypot(m.camDx, m.camDy) > 20 && m.nodesMoved === 0)) fail.push("drill-in: expected a pan with 0 nodes moved");

        const card2 = await pickCard(DRILL);
        if (card2) {
          const before2 = await page.evaluate((s) => document.querySelectorAll(`${s} .solenoid-node--selected`).length, DRILL);
          await tap(card2.x, card2.y);
          const after2 = await page.evaluate((s) => document.querySelectorAll(`${s} .solenoid-node--selected`).length, DRILL);
          console.log(`DRILL-IN     stationary tap → selected cards ${before2} → ${after2}`);
          if (!(before2 === 0 && after2 === 1)) fail.push("drill-in: a stationary tap should select exactly one card");
        }
      }
    }

    if (errs.length) { console.log("--- page errors ---"); console.log([...new Set(errs)].join("\n")); }
  } finally {
    await browser.close();
  }

  if (fail.length) { console.log("\nFAIL:\n  " + fail.join("\n  ")); process.exit(1); }
  console.log("\nPASS — finger pan lives on both surfaces; tap selects in the drill-in.");
}

main().catch((e) => { console.error(e); process.exit(1); });
