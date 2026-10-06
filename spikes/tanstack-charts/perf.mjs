// Usage: node spikes/tanstack-charts/perf.mjs ["pts=2000&charts=12"]  (BASE=http://localhost:1431 for the production preview)
import puppeteer from "puppeteer-core";
import { browserPath } from "../../scripts/browser.mjs";
const b = await puppeteer.launch({ executablePath: browserPath(), args: ["--no-sandbox"] });
for (const lib of ["rc", "ts", "rc", "ts"]) {
  const p = await b.newPage();
  p.on("pageerror", (e) => console.log("PAGEERR", e.message));
  await p.goto(`${process.env.BASE ?? "http://localhost:1430"}/perf?lib=${lib}&${process.argv[2] ?? ""}`, { waitUntil: "load" });
  await p.waitForFunction(() => window.RESULT, { timeout: 60000 });
  console.log(JSON.stringify(await p.evaluate(() => window.RESULT)));
  await p.close();
}
await b.close();
