// [[B10]] reactFlowView
// Probes, at two zooms (one fractional), that every Handle's measured box is the glyph box at
// --socket-size and that each plain cable's drawn ends sit on the rim of the handle React Flow measured.
// Conduit lanes are exempt, since their tips come from conduitLaneOffset. sourceInvariants.test.ts pins
// the greppable half. Needs the dev server on :1420.
//   node scripts/socket-box-probe.mjs
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const CHROME = browserPath();
const SEEDS = ["getting-started", "power-features", "unit-flow"];
const ZOOMS = [1, 1.37];
const TOL = 1.0;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
let failures = 0;
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:1420", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 20000 });

  for (const seed of SEEDS) {
    await page.evaluate((id) => window.__spike.seed(id), seed);
    await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
    await wait(1200);

    for (const k of ZOOMS) {
      await page.evaluate((k) => window.__spike.zoomNode("", k, 100, 100), k);
      await wait(400);

      const r = await page.evaluate((TOL) => {
        const k = window.__spike.transform().k;
        const bad = [];
        const handles = [...document.querySelectorAll(".react-flow__handle.sol-rf-handle-reset")]
          .filter((h) => !h.closest(".solenoid-conduit"));
        let measured = 0;
        for (const h of handles) {
          const hr = h.getBoundingClientRect();
          if (hr.width === 0 && hr.height === 0) continue;
          measured++;
          const size = parseFloat(getComputedStyle(h).getPropertyValue("--socket-size")) || 12;
          const glyph = h.querySelector(".solenoid-socket-dot");
          const gr = glyph?.getBoundingClientRect();
          const who = `${h.dataset.nodeid}/${h.dataset.handleid}`;
          const w = hr.width / k, ht = hr.height / k;
          if (Math.abs(w - size) > 0.5 || Math.abs(ht - size) > 0.5)
            bad.push(`${who}: handle box ${w.toFixed(2)}×${ht.toFixed(2)} ≠ ${size}`);
          if (!gr) bad.push(`${who}: no glyph inside the handle`);
          else if (Math.abs(gr.left - hr.left) > TOL || Math.abs(gr.top - hr.top) > TOL ||
                   Math.abs(gr.width - hr.width) > TOL || Math.abs(gr.height - hr.height) > TOL)
            bad.push(`${who}: glyph box ≠ handle box (Δ ${(gr.left - hr.left).toFixed(2)},${(gr.top - hr.top).toFixed(2)})`);
          if (getComputedStyle(h).transform !== "none") bad.push(`${who}: handle has a transform`);
        }

        const rimOf = (nodeId, handleId, type) => {
          const el = document.querySelector(
            `.react-flow__handle.${type}.sol-rf-handle-reset[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`);
          if (!el || el.closest(".solenoid-conduit")) return null;
          const r = el.getBoundingClientRect();
          if (r.width === 0) return null;
          return { x: type === "source" ? r.right : r.left, y: r.top + r.height / 2 };
        };
        let cables = 0;
        for (const c of window.__spike.connections()) {
          const e = document.querySelector(`.react-flow__edge[data-id="${c.id}"]`);
          if (!e) continue;
          const paths = e.querySelectorAll("path.react-flow__edge-path");
          if (paths.length !== 1) continue;
          const path = paths[0];
          const src = rimOf(c.source, c.sourceOutput, "source");
          const tgt = rimOf(c.target, c.targetInput, "target");
          if (!src || !tgt) continue;
          const ctm = path.getScreenCTM();
          const len = path.getTotalLength();
          const at = (l) => { const p = path.getPointAtLength(l).matrixTransform(ctm); return { x: p.x, y: p.y }; };
          const a = at(0), b = at(len);
          cables++;
          const dA = Math.hypot(a.x - src.x, a.y - src.y), dB = Math.hypot(b.x - tgt.x, b.y - tgt.y);
          if (dA > TOL || dB > TOL)
            bad.push(`cable ${c.id}: ends off the handle rims by ${dA.toFixed(2)} / ${dB.toFixed(2)}px`);
        }
        return { measured, cables, bad };
      }, TOL);

      console.log(`${seed} @${k}: ${r.measured} handles, ${r.cables} plain cables — ${r.bad.length ? r.bad.length + " problem(s)" : "clean"}`);
      for (const b of r.bad) console.log("  " + b);
      failures += r.bad.length;
    }
  }
  console.log(failures === 0 ? "CLEAN: every handle is the glyph box at --socket-size and cables land on its rim"
    : `${failures} problem(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
}
