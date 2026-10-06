import puppeteer from "puppeteer-core";
import { browserPath } from "../../scripts/browser.mjs";
const b = await puppeteer.launch({ executablePath: browserPath(), args: ["--no-sandbox"] });
const p = await b.newPage();
await p.goto(process.argv[2], { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1000));
console.log(await p.evaluate((i) => document.querySelectorAll(".cell")[i].innerHTML, Number(process.argv[3])));
await b.close();
