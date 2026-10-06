// Usage: node spikes/tanstack-charts/hover.mjs <url> <out.png> [click]  — hovers (or clicks) the middle of the first chart.
import puppeteer from "puppeteer-core";
import { browserPath } from "../../scripts/browser.mjs";
const b = await puppeteer.launch({ executablePath: browserPath(), args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 600, height: 400, deviceScaleFactor: 2 });
await p.goto(process.argv[2], { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
const box = await (await p.$("svg.ts-chart")).boundingBox();
const x = box.x + box.width * Number(process.env.FX ?? 0.55), y = box.y + box.height * Number(process.env.FY ?? 0.5);
await p.mouse.move(x, y);
if (process.argv[4] === "click") await p.mouse.click(x, y);
await new Promise((r) => setTimeout(r, 400));
console.log(await p.evaluate(() => document.querySelector(".ts-chart-tooltip")?.textContent ?? "no tooltip"));
await p.screenshot({ path: process.argv[3] });
await b.close();
