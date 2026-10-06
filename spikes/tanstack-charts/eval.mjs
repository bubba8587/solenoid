// Usage: node spikes/tanstack-charts/eval.mjs <url> '<js expression>'
import puppeteer from "puppeteer-core";
import { browserPath } from "../../scripts/browser.mjs";
const b = await puppeteer.launch({ executablePath: browserPath(), args: ["--no-sandbox"] });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("PAGEERR", e.message));
await p.goto(process.argv[2], { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify(await p.evaluate(process.argv[3]), null, 1));
await b.close();
