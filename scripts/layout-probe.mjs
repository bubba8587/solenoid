// Probes group layout on the real page: collapse (E), drag a collapsed group, expand (E), and every
// member must follow by the group's exact delta; then Tidy (T), Cleanup (C) and Autofit (F) must each
// run with no page errors and no __spike.mismatches(). Needs the dev server on :1420.
//   node scripts/layout-probe.mjs
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const CHROME = browserPath();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (ok, msg) => { console.log((ok ? "ok  " : "FAIL") + " " + msg); if (!ok) bad++; };

const browser = await puppeteer.launch({
  headless: true, executablePath: CHROME,
  args: ["--window-size=1600,1000"], defaultViewport: { width: 1600, height: 1000 },
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR " + String(e).split("\n")[0]); bad++; });
  await page.goto("http://localhost:1420", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 20000 });
  await page.evaluate(() => window.__spike.seed("getting-started"));
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
  await wait(1200);

  const snap = () => page.evaluate(() => window.__spike.positions());
  const mism = () => page.evaluate(() => window.__spike.mismatches());
  const groupsOf = (rows) => rows.filter((r) => r.type === "GroupNode");

  const membership = await page.evaluate(() => {
    const out = {};
    for (const n of window.__spike.connections ? [] : []) void n;
    return out;
  });
  void membership;

  await page.mouse.click(1300, 900);
  await wait(150);

  const before = await snap();
  const g0 = groupsOf(before)[0];
  check(!!g0, "seed has a group");

  await page.keyboard.press("KeyE");
  await wait(600);

  const t = await page.evaluate(() => window.__spike.transform());
  const gNow = groupsOf(await snap()).find((r) => r.id === g0.id);
  const sx = gNow.x * t.k + t.x + 60, sy = gNow.y * t.k + t.y + 14;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(sx + i * 14, sy + i * 9); await wait(16); }
  await page.mouse.up();
  await wait(400);

  await page.keyboard.press("KeyE");
  await wait(800);

  const after = await snap();
  const gAfter = after.find((r) => r.id === g0.id);
  const dx = gAfter.x - g0.x, dy = gAfter.y - g0.y;
  check(Math.hypot(dx, dy) > 60, `group actually dragged (Δ ${dx.toFixed(1)},${dy.toFixed(1)})`);

  // Only members are checked: the expand push may legitimately shove neighbors aside.
  const members = (await page.evaluate(() => window.__spike.groups())).find((g) => g.id === g0.id).members;
  check(members.length > 0, `group has members (${members.length})`);
  let coherent = true;
  for (const id of members) {
    const b = before.find((x) => x.id === id), r = after.find((x) => x.id === id);
    if (!b || !r) continue;
    const mx = r.x - b.x, my = r.y - b.y;
    if (Math.abs(mx - dx) > 0.51 || Math.abs(my - dy) > 0.51) {
      coherent = false;
      console.log(`  desync member ${r.type} "${r.label}": Δ ${mx.toFixed(1)},${my.toFixed(1)} vs group ${dx.toFixed(1)},${dy.toFixed(1)}`);
    }
  }
  check(coherent, "every member followed by exactly the group's delta");
  const m1 = await mism();
  check(m1.length === 0, `no model/DOM mismatches after collapsed drag (${m1.length})`);

  for (const [key, label, settle] of [["KeyT", "tidy", 2500], ["KeyC", "cleanup", 3500], ["KeyF", "autofit", 1200]]) {
    await page.mouse.click(1300, 900);
    await wait(100);
    await page.keyboard.press(key);
    await wait(settle);
    const mm = await mism();
    check(mm.length === 0, `${label}: no model/DOM mismatches (${mm.length})`);
  }

  console.log(bad === 0 ? "CLEAN" : `${bad} problem(s)`);
  process.exitCode = bad === 0 ? 0 : 1;
} finally {
  await browser.close();
}
