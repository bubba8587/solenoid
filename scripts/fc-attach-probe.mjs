// The author's FC-reload case, replayed: script-tour → the "Friday the 13ths" Script →
// its Display → attach an FC on the Display's output → pick the "Wed, Jun 3, 2026" date
// style → autosave → reload the document → the FC must still say date_dow and the box
// must render that style. Dev server on :1420.
//
//   node scripts/fc-attach-probe.mjs
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ??
  `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe`;
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SEED = "script-tour";
const DISPLAY_LABEL = "13-Feb";
const KEYS = ["format", "socketDataType", "hostNodeId", "unit"];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("http://localhost:1420", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__spike, { timeout: 20000 });
  await page.evaluate((id) => window.__spike.seed(id), SEED);
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
  await wait(1500);

  const findDisplay = () => page.evaluate((lab) => {
    const p = window.__spike.positions().find((q) => q.type === "DisplayNode" && q.label.includes(lab));
    return p ? p.id : null;
  }, DISPLAY_LABEL);
  const boxText = (id) => page.evaluate((nid) => {
    const el = document.querySelector(`.react-flow__node[data-id="${nid}"] .solenoid-node__display-value`);
    return el ? el.textContent.trim() : null;
  }, id);
  const fcOn = (hostId) => page.evaluate((h, keys) =>
    window.__spike.positions().filter((p) => p.type === "FormatControllerNode")
      .map((p) => ({ id: p.id, ...window.__spike.fields(p.id, keys) })).find((f) => f.hostNodeId === h) ?? null,
  hostId, KEYS);

  let disp = await findDisplay();
  if (!disp) throw new Error("no Friday-13ths Display found");
  console.log(`before: box = "${await boxText(disp)}"`);
  const ok = await page.evaluate((h) => window.__spike.attachFc(h, "out", "output"), disp);
  if (!ok) throw new Error("attachFc failed");
  await wait(500);
  let fc = await fcOn(disp);
  console.log(`attached FC: ${JSON.stringify(fc)}`);
  await page.evaluate((id) => window.__spike.patch(id, { format: "date_dow" }), fc.id);
  await wait(500);
  fc = await fcOn(disp);
  console.log(`after pick: FC ${JSON.stringify(fc)}; box = "${await boxText(disp)}"`);
  await wait(1600); // autosave

  await page.keyboard.down("Control"); await page.keyboard.down("Shift"); await page.keyboard.press("KeyL"); await page.keyboard.up("Shift"); await page.keyboard.up("Control");
  await wait(800);
  await page.waitForFunction(() => window.__spike.revealPhase() === "idle", { timeout: 20000 });
  await wait(2000);
  disp = await findDisplay();
  fc = await fcOn(disp);
  const box = await boxText(disp);
  console.log(`after reload: FC ${JSON.stringify(fc)}; box = "${box}"`);
  const kept = fc && fc.format === "date_dow";
  const rendered = typeof box === "string" && /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d/.test(box);
  console.log(kept && rendered ? "CLEAN: the pick survived and the box renders it"
    : `${kept ? "" : "FAIL: the FC lost the pick. "}${rendered ? "" : "FAIL: the box does not render the pick."}`);
  process.exitCode = kept && rendered ? 0 : 1;
} finally {
  await browser.close();
}
