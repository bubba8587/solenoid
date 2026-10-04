// Renders the home-screen icons in public/icons/ from src/logo/solenoidicon.svg, the six-rung mark ([[C119]] landscapePhoneIsTablet: installed,
// the app opens without browser bars and keeps its landscape scale). Run after the logo changes: node scripts/pwa-icons.mjs
import { readFileSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const root = new URL("..", import.meta.url).pathname;
const logo = `data:image/svg+xml;base64,${readFileSync(`${root}src/logo/solenoidicon.svg`).toString("base64")}`;
const BG = "#0b0b0b"; // the dark canvas, --canvas-bg
// A maskable icon keeps its art inside the central 80% circle; "any" icons get a rounded tile of their own.
const ICONS = [
  { file: "icon-192.png", size: 192, glyph: 0.62, radius: 0.22 },
  { file: "icon-512.png", size: 512, glyph: 0.62, radius: 0.22 },
  { file: "icon-maskable-512.png", size: 512, glyph: 0.5, radius: 0 },
];

mkdirSync(`${root}public/icons`, { recursive: true });
const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  for (const { file, size, glyph, radius } of ICONS) {
    await page.setViewport({ width: size, height: size });
    const g = Math.round(size * glyph);
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px;background:${BG};border-radius:${size * radius}px;display:grid;place-items:center">
        <img src="${logo}" style="width:${g}px;height:${g}px;object-fit:contain"></div></body></html>`);
    await page.waitForFunction(() => document.querySelector("img").complete);
    await page.screenshot({ path: `${root}public/icons/${file}`, omitBackground: true });
    console.log(`public/icons/${file}`);
  }
} finally {
  await browser.close();
}
