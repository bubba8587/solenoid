// Repro: rename a wired captured variable in a LAMBDA via the formula popup in
// the LIVE app, and report whether the old socket/cable actually disappear.
// Drives the running Vite dev server (port 1420) with system Edge, headless.
//   node scripts/repro-lambda-rename.mjs
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = "http://localhost:1420";

const graph = {
  label: "Repro",
  v: 2,
  nodes: [
    { id: "s1", type: "SliderInputNode", x: 60, y: 380, init: { label: "Rate", value: 3, min: 0, max: 10, step: 0.5 }, literals: { min: 0, max: 10, step: 0.5 } },
    { id: "l1", type: "LambdaNode", x: 360, y: 380, init: { label: "× rate", params: "x", expr: "x * rate" }, literals: { rate: 3 } },
    { id: "r1", type: "RangeNode", x: 60, y: 720, init: { label: "1 to 6" }, literals: { start: 1, stop: 7, step: 1 } },
    { id: "m1", type: "MapTableNode", x: 680, y: 420, init: { label: "MAP" }, literals: {}, stringLiterals: { formula: "x^2" } },
  ],
  connections: [
    { source: "s1", sourceOutput: "value", target: "l1", targetInput: "rate" },
    { source: "l1", sourceOutput: "result", target: "m1", targetInput: "lambda" },
    { source: "r1", sourceOutput: "list", target: "m1", targetInput: "table" },
  ],
};

function snapshotFn() {
  const nodes = [...document.querySelectorAll(".solenoid-node")];
  const lambda = nodes.find((n) => n.textContent.includes("× rate") || n.textContent.includes("bazinga"));
  const rows = lambda
    ? [...lambda.querySelectorAll(".solenoid-node__io-row")].map((r) => {
        const label = r.querySelector(".solenoid-node__io-label")?.textContent ?? "";
        const wired = r.querySelector(".solenoid-node__io-wired")?.textContent ?? null;
        return { label, wired };
      })
    : null;
  return {
    nodeCount: nodes.length,
    cableCount: document.querySelectorAll(".solenoid-cable-hit").length,
    lambdaText: lambda ? lambda.textContent : "(lambda node not found)",
    lambdaRows: rows,
    popupOpen: !!document.querySelector(".formula-popup__textarea"),
  };
}

const main = async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--window-size=1700,1100"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1100 });

  const logs = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[console.${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

  await page.evaluateOnNewDocument((g) => {
    localStorage.setItem("solenoid.graph.autosave.v1", JSON.stringify(g));
  }, graph);

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector(".solenoid-node", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));

  const before = await page.evaluate(snapshotFn);
  console.log("BEFORE:", JSON.stringify(before, null, 2));

  // Click the LAMBDA node's formula box to open the popup.
  const opened = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".solenoid-node")];
    const lambda = nodes.find((n) => n.textContent.includes("× rate"));
    const box = lambda?.querySelector(".solenoid-expr__rendered");
    if (!box) return false;
    const r = box.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!opened) { console.log("FAIL: formula box not found"); await browser.close(); return; }
  const atPoint = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}.${el.className?.toString?.().slice(0, 80)}` : "(none)";
  }, opened);
  console.log("click target at point:", atPoint, opened);
  await page.mouse.click(opened.x, opened.y);
  await new Promise((r) => setTimeout(r, 600));
  console.log("popup overlay present:", await page.evaluate(() => !!document.querySelector(".sol-popup-overlay")));
  await page.waitForSelector(".formula-popup__textarea", { timeout: 5000 });

  // Replace the formula text wholesale.
  await page.click(".formula-popup__textarea");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.type("x * bazinga");
  if (process.argv[2] === "overlay") {
    // Close by clicking off the popup (the overlay), like a user clicking away.
    await page.mouse.click(60, 1000);
  } else {
    await page.keyboard.press("Escape");
  }
  await new Promise((r) => setTimeout(r, 1500));

  const after = await page.evaluate(snapshotFn);
  console.log("AFTER:", JSON.stringify(after, null, 2));

  console.log("--- console/page errors ---");
  console.log(logs.length ? logs.join("\n") : "(none)");

  const ok =
    after.lambdaRows?.some((r) => r.label === "bazinga") &&
    !after.lambdaRows?.some((r) => r.label === "rate") &&
    after.cableCount === before.cableCount - 1;
  console.log(ok ? "RESULT: rename applied live (socket churned, cable dropped)" : "RESULT: REPRODUCED — live state did not update");

  await browser.close();
};

main().catch((e) => { console.error(e); process.exit(1); });
