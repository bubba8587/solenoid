// Regenerates src-tauri/icons/debug/icon.png: the app icon with a bug badge, which debug
// builds set as their window icon (lib.rs) so they can't be mistaken for the release app.
//
//   node scripts/debug-icon.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const icons = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
const base = fs.readFileSync(path.join(icons, "icon.png")).toString("base64");
const SIZE = 256;

// Bug glyph: Tabler Icons "bug" (MIT).
const html = `<body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <image href="data:image/png;base64,${base}" width="512" height="512"/>
  <circle cx="362" cy="362" r="150" fill="#d92d3a"/>
  <g transform="translate(242 242) scale(10)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 9v-1a3 3 0 0 1 6 0v1"/>
    <path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3"/>
    <path d="M3 13h4"/><path d="M17 13h4"/><path d="M12 20v-6"/>
    <path d="M4 19l3.35 -2"/><path d="M20 19l-3.35 -2"/>
    <path d="M4 7l3.75 2.4"/><path d="M20 7l-3.75 2.4"/>
  </g>
</svg></body>`;

const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: SIZE, height: SIZE });
  await page.setContent(html);
  fs.mkdirSync(path.join(icons, "debug"), { recursive: true });
  const out = path.join(icons, "debug", "icon.png");
  await page.screenshot({ path: out, omitBackground: true });
  // lib.rs embeds the raw RGBA (no PNG decoder in the binary); the PNG is the reviewable copy.
  const rgba = await page.evaluate(async (size) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(document.querySelector("svg")));
    await img.decode();
    const ctx = Object.assign(document.createElement("canvas"), { width: size, height: size }).getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    return Array.from(ctx.getImageData(0, 0, size, size).data);
  }, SIZE);
  fs.writeFileSync(path.join(icons, "debug", "icon.rgba"), Buffer.from(rgba));
  console.log(`wrote ${out} and icon.rgba (${SIZE}x${SIZE})`);
} finally {
  await browser.close();
}
