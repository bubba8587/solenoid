// Does a Format Controller keep its picks across a document reload? Loads a seed,
// patches every FC's format (a date FC to a different date style, a number FC to
// percent / 4 places / parens), lets the autosave land, reloads the current document
// (Ctrl+Shift+L) and reads the FCs back. Dev server on :1420.
//
//   node scripts/fc-reload-probe.mjs [seed-id]
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SEED = process.argv[2] ?? "getting-started";
const KEYS = ["format", "decimalDigits", "decimalMode", "unit", "negativeStyle", "grouping", "scaleMode", "socketDataType", "hostNodeId"];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
let failures = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("http://localhost:1420", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 20000 });
  await page.evaluate((id) => window.__spike.seed(id), SEED);
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
  await wait(1500);

  const fcs = await page.evaluate((keys) =>
    (() => { const all = window.__spike.positions(); return all.filter((p) => p.type === "FormatControllerNode").map((p) => { const f = window.__spike.fields(p.id, keys); const host = all.find((q) => q.id === f.hostNodeId); return { id: p.id, label: `${host?.label ?? "?"}/${host?.type ?? "?"}`, ...f }; }); })(),
  KEYS);
  console.log(`${SEED}: ${fcs.length} FC(s)`);
  if (fcs.length === 0) process.exit(0);

  // Patch: a date-family FC gets another date style; a number-family one percent/4/parens.
  const wanted = new Map();
  for (const fc of fcs) {
    const isDate = String(fc.format).startsWith("date_") || String(fc.socketDataType).startsWith("date");
    const next = isDate
      ? { format: fc.format === "date_iso" ? "date_dmy" : "date_iso" }
      : { format: "percent", decimalDigits: 4, negativeStyle: "parens", grouping: false };
    wanted.set(fc.id, next);
    await page.evaluate((id, f) => window.__spike.patch(id, f), fc.id, next);
    console.log(`  patched ${fc.id} (${fc.label}, ${fc.socketDataType}): ${JSON.stringify(fc)} -> ${JSON.stringify(next)}`);
  }
  await wait(1600); // autosave debounce is 700ms

  // The FC ids change on reload (persistence remaps), so match by host + label.
  const before = await page.evaluate((keys) =>
    (() => { const all = window.__spike.positions(); return all.filter((p) => p.type === "FormatControllerNode").map((p) => { const f = window.__spike.fields(p.id, keys); const host = all.find((q) => q.id === f.hostNodeId); return { id: p.id, label: `${host?.label ?? "?"}/${host?.type ?? "?"}`, ...f }; }); })(),
  KEYS);
  await page.keyboard.down("Control"); await page.keyboard.down("Shift"); await page.keyboard.press("KeyL"); await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  await wait(800);
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
  await wait(1500);
  const after = await page.evaluate((keys) =>
    (() => { const all = window.__spike.positions(); return all.filter((p) => p.type === "FormatControllerNode").map((p) => { const f = window.__spike.fields(p.id, keys); const host = all.find((q) => q.id === f.hostNodeId); return { id: p.id, label: `${host?.label ?? "?"}/${host?.type ?? "?"}`, ...f }; }); })(),
  KEYS);

  for (const b of before) {
    const a = after.find((x) => x.label === b.label && x.socketDataType === b.socketDataType) ?? after.find((x) => x.label === b.label);
    if (!a) { console.log(`  MISSING after reload: ${b.label}`); failures++; continue; }
    const diffs = KEYS.filter((k) => k !== "hostNodeId" && String(a[k]) !== String(b[k])).map((k) => `${k}: ${b[k]} -> ${a[k]}`);
    console.log(`  ${b.label}: ${diffs.length ? "CHANGED " + diffs.join(", ") : "kept"}`);
    if (diffs.length) failures++;
  }
  console.log(failures ? `${failures} FC(s) lost a pick on reload` : "CLEAN: every FC kept its picks across the reload");
  process.exitCode = failures ? 1 : 0;
} finally {
  await browser.close();
}
