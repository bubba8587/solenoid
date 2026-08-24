// OS-dropdown precaution probe — settles "does a native <select> inside a node close
// when the card is picked?" WITHOUT observing the native popup (which is OS chrome, not
// DOM, so it is un-inspectable headed or headless). Instead it measures the two candidate
// CAUSES a close would have, both DOM-observable:
//   (a) simpleNodesOrder re-appends the picked node's element to the holder END on
//       `nodepicked` (a DOM move that reparents the <select> → Chrome closes an open
//       native popup on reparent). Measured as: after a card-body mousedown, is the node
//       element now its parent's lastElementChild when it was not before?
//   (b) our selection → React re-render REMOUNTS the <select> (a new DOM element → the
//       popup dies with the old one). Measured with an expando marker: set select.__mark
//       before the pick; if the post-pick <select> still carries it, React PRESERVED the
//       element (re-render is NOT a closer); if gone, it remounted.
// Desktop model (no mobile emulation): the swallow precaution lives on the desktop path.
//
//   node scripts/dropdown-reorder-probe.mjs
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:1420";
const SEEDS = ["table-verbs", "chart-showcase", "zz-scratch-new-nodes"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1600,1100"] });
  const out = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 });
    page.setDefaultTimeout(120000);
    const client = await page.target().createCDPSession();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(`[console] ${m.text()}`); });
    page.on("pageerror", (e) => errs.push(`[pageerror] ${e.message}`));

    await page.goto(URL, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => typeof window.__solenoidTuneSeed === "function");
    await page.waitForSelector(".solenoid-node");
    await sleep(3500);

    // Find the first seed that puts a <select> inside a .solenoid-node.
    let seedUsed = null, target = null;
    for (const seed of SEEDS) {
      await page.evaluate((id) => window.__solenoidTuneSeed(id), seed);
      await sleep(1600);
      target = await page.evaluate(() => {
        for (const node of document.querySelectorAll(".solenoid-node")) {
          const sel = node.querySelector("select");
          if (sel) {
            const r = node.getBoundingClientRect();
            // A body point NOT over the select (mousedown there = pick the card, not the control).
            const sr = sel.getBoundingClientRect();
            const bodyY = sr.bottom + 8 < r.bottom ? sr.bottom + 8 : r.top + 6;
            return { ok: true, cx: Math.round(r.left + r.width / 2), bodyY: Math.round(bodyY),
                     top: Math.round(r.top + 4), left: Math.round(r.left + 4) };
          }
        }
        return { ok: false };
      });
      if (target.ok) { seedUsed = seed; break; }
    }
    if (!target?.ok) { console.log("FAIL: no seed produced a <select> inside a node"); return; }
    console.log(`seed: ${seedUsed}  node body point: (${target.cx}, ${target.bodyY})`);

    // Pin a STABLE identity on the target node + its select (survives a DOM reparent,
    // so we track the SAME element across simpleNodesOrder's reorder). Record the target's
    // index among ALL .solenoid-node in document order — a re-append sends it to LAST.
    const before = await page.evaluate(() => {
      const all = [...document.querySelectorAll(".solenoid-node")];
      let node = null, sel = null;
      for (const n of all) { const s = n.querySelector("select"); if (s) { node = n; sel = s; break; } }
      node.__pnode = 0xC0FFEE; sel.__psel = 0xBEEF;
      return {
        markSet: node.__pnode === 0xC0FFEE && sel.__psel === 0xBEEF,
        docIndex: all.indexOf(node), total: all.length,
        selValue: sel.value,
        selectedBefore: node.classList.contains("solenoid-node--selected"),
      };
    });

    // A real desktop mousedown+up on the CARD BODY (bubbles to the node drag handler → pick;
    // selection commits on pointerup per our selection-on-pointerup rule).
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.cx, y: target.bodyY, button: "left", clickCount: 1 });
    await sleep(150);
    const midDown = await page.evaluate(() => {
      const all = [...document.querySelectorAll(".solenoid-node")];
      const node = all.find((n) => n.__pnode === 0xC0FFEE);
      return { found: !!node, docIndex: node ? all.indexOf(node) : -1, total: all.length };
    });
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.cx, y: target.bodyY, button: "left", clickCount: 1 });
    await sleep(450);

    const after = await page.evaluate(() => {
      const all = [...document.querySelectorAll(".solenoid-node")];
      const node = all.find((n) => n.__pnode === 0xC0FFEE);
      if (!node) return { found: false };
      const sel = node.querySelector("select");
      return {
        found: true,
        docIndex: all.indexOf(node), total: all.length,
        selPresent: !!sel,
        selMarkSurvived: !!sel && sel.__psel === 0xBEEF, // true = same <select> element (React preserved it)
        selectedAfter: node.classList.contains("solenoid-node--selected"),
      };
    });

    const reappended = before.docIndex < before.total - 1 &&
                       (midDown.docIndex === midDown.total - 1 || after.docIndex === after.total - 1);
    console.log("\n--- (a) DOM re-append on pick (simpleNodesOrder), tracking the SAME node ---");
    console.log(`  target doc-order index among nodes: before ${before.docIndex}/${before.total - 1}` +
                `, during-down ${midDown.docIndex}/${midDown.total - 1}, after ${after.docIndex}/${after.total - 1}`);
    console.log(`  => DOM re-append on pick: ${reappended ? "YES (moved to LAST in document order)" : "NO"}`);

    console.log("\n--- (b) does the SAME <select> survive the pick's re-render ---");
    console.log(`  marks set before: ${before.markSet}; node still found after: ${after.found}; select present after: ${after.selPresent}`);
    console.log(`  node selected: before=${before.selectedBefore} after=${after.selectedAfter}  (did the pick select it?)`);
    console.log(`  => <select> element: ${after.selMarkSurvived ? "PRESERVED (same element — re-render is NOT a closer)" : "REMOUNTED (new element — a closer)"}`);

    console.log("\n--- verdict ---");
    if (reappended && after.selMarkSurvived)
      console.log("  Only the DOM re-append can close the popup → zIndexNodesOrder (no re-append) would FIX it.");
    else if (!reappended && after.selMarkSurvived)
      console.log("  Neither cause fires on pick → precaution looks FALSE (no DOM move, select preserved).");
    else if (after.selPresent && !after.selMarkSurvived)
      console.log("  The re-render REMOUNTS the select → order-independent → zIndexNodesOrder would NOT fix it.");

    if (errs.length) console.log("\nconsole/page errors:\n  " + errs.slice(0, 6).join("\n  "));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
