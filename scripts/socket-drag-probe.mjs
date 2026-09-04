// The browser half of "a cable starts from EITHER end": presses the first visible input
// (RF target) and output (source) handles of a seed and checks each begins a cable drag
// (cabling class + RF connection line, no node drag), then drags from an unwired input
// onto an output on another node and checks a connection lands. The 2026-09-04
// regression this pins: the input wrapper's rest halo (socket.css ::before) painted over
// a `position: static` Handle, so the wrapper swallowed the press (flow.css reset).
//
//   node scripts/socket-drag-probe.mjs [seed-id]     (dev server on :1420)
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SEED = process.argv[2] ?? "getting-started";

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text()); });
  await page.goto("http://localhost:1420", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 20000 });
  await page.evaluate((id) => window.__spike.seed(id), SEED);
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
  await wait(1200);
  await page.evaluate(() => window.__spike.zoomNode("", 1.25, 300, 200));
  await wait(500);

  const info = await page.evaluate(() => {
    const pick = (type) => {
      const out = [];
      for (const h of document.querySelectorAll(`.react-flow__handle.${type}.sol-rf-handle-reset`)) {
        const r = h.getBoundingClientRect();
        if (r.width === 0 || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) continue;
        if (h.closest(".solenoid-conduit")) continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const under = document.elementFromPoint(cx, cy);
        const cs = getComputedStyle(h);
        out.push({
          cx, cy, node: h.dataset.nodeid, handle: h.dataset.handleid,
          // The wrapper's title is the socket's TYPE label (NodeSocket) — equal titles
          // are a type-compatible pair for the end-to-end drop below.
          type: h.parentElement?.getAttribute("title") ?? "",
          cls: h.className, pe: cs.pointerEvents, cursor: cs.cursor,
          hit: under === h || h.contains(under),
          under: under ? `${under.tagName.toLowerCase()}.${String(under.className).slice(0, 60)}` : null,
          underCursor: under ? getComputedStyle(under).cursor : null,
          wrapperPe: h.parentElement ? getComputedStyle(h.parentElement).pointerEvents : null,
        });
        if (out.length >= 14) break;
      }
      return out;
    };
    return { target: pick("target"), source: pick("source") };
  });
  console.log(JSON.stringify(info, null, 1));

  // Re-measure each handle right before its press (an earlier release may have
  // selected or nudged something), and release on the empty pane corner.
  const rectOf = (h) => page.evaluate((node, handle, type) => {
    const el = document.querySelector(`.react-flow__handle.${type}.sol-rf-handle-reset[data-nodeid="${node}"][data-handleid="${handle}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const under = document.elementFromPoint(cx, cy);
    return { cx, cy, hit: under === el || el.contains(under), under: under ? `${under.tagName.toLowerCase()}.${String(under.className).slice(0, 50)}` : null };
  }, h.node, h.handle, h.side);
  for (const side of ["target", "source"]) {
    for (const h0 of info[side].slice(0, 3)) {
      const h = { ...h0, side, ...(await rectOf({ ...h0, side })) };
      await page.mouse.move(h.cx, h.cy); await wait(120);
      const hoverCursor = await page.evaluate((x, y) => { const el = document.elementFromPoint(x, y); return el ? getComputedStyle(el).cursor : null; }, h.cx, h.cy);
      await page.mouse.down(); await wait(60);
      await page.mouse.move(h.cx + 70, h.cy + 40, { steps: 8 }); await wait(200);
      const st = await page.evaluate(() => ({
        cablingClass: !!document.querySelector(".solenoid-canvas--cabling"),
        connLine: !!document.querySelector(".react-flow__connectionline, .react-flow__connection"),
        nodeDragging: !!document.querySelector(".react-flow__node.dragging"),
        connectingFrom: !!document.querySelector(".react-flow__handle.connectingfrom"),
        selectionRect: !!document.querySelector(".react-flow__selection, .react-flow__nodesselection-rect"),
      }));
      console.log(`${side} ${h.node}/${h.handle}: hit=${h.hit} under=${h.under} hoverCursor=${hoverCursor} drag=${JSON.stringify(st)}`);
      await page.mouse.up(); await wait(250);
      await page.keyboard.press("Escape"); await wait(100);
      await page.mouse.click(30, 960); await wait(150); // empty pane: clears any selection
    }
  }

  // End to end: a cable dragged from an input and released on a same-type output on
  // another node must land — as a new cable on an unwired input, or as a re-sourced
  // cable on a wired one (an input holds one cable). Tries visible same-type pairs
  // until one changes the connection set; the start is the probe's point, the
  // reverse-drop is RF's.
  const connSet = () => page.evaluate(() =>
    window.__spike.connections().map((c) => `${c.source}/${c.sourceOutput}>${c.target}/${c.targetInput}`).sort().join("\n"));
  let connected = false;
  let tried = 0;
  outer: for (const t0 of info.target) {
    for (const s0 of info.source) {
      if (s0.node === t0.node || !t0.type || s0.type !== t0.type) continue;
      const before = await connSet();
      if (before.includes(`${s0.node}/${s0.handle}>${t0.node}/${t0.handle}`)) continue; // already that cable
      const t = { ...t0, ...(await rectOf({ ...t0, side: "target" })) };
      const s = { ...s0, ...(await rectOf({ ...s0, side: "source" })) };
      if (!t.hit || !s.hit) continue;
      tried++;
      await page.mouse.move(t.cx, t.cy); await wait(100);
      await page.mouse.down(); await wait(60);
      await page.mouse.move(s.cx, s.cy, { steps: 12 }); await wait(200);
      await page.mouse.up(); await wait(400);
      const after = await connSet();
      const landed = after !== before && after.includes(`${s.node}/${s.handle}>${t.node}/${t.handle}`);
      console.log(`input→output drop ${t.node}/${t.handle} ← ${s.node}/${s.handle} (${t.type}): ${landed ? "landed" : "no change"}`);
      if (landed) { connected = true; break outer; }
      await page.mouse.click(30, 960); await wait(150);
    }
  }
  console.log(connected ? "OK: a cable started at an input landed on release over an output"
    : tried ? "FAIL: no input-started cable landed" : "SKIP: no same-type input/output pair in view");
  if (tried) process.exitCode = connected ? 0 : 2;
} finally {
  await browser.close();
}
