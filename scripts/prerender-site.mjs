// Snapshots each site page's text (headings, paragraphs, list items, links) into prerender/<page>.html; the build pastes it into dist/<page>.html's
// #root (vite.config.ts sitePageHtml), so crawlers and link previews read the page without running JavaScript, and
// React replaces the snapshot when it mounts. Vercel's build can't run a browser, so the snapshots are committed.
// Run after changing a site page's copy:  node scripts/prerender-site.mjs   (builds first, then serves dist/)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser.mjs";

const root = new URL("..", import.meta.url).pathname;
const PAGES = { about: "/about", obsidian: "/obsidian", download: "/download", examples: "/examples", packs: "/packs" };
const PORT = 4174;

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
const browser = await puppeteer.launch({ executablePath: browserPath(), headless: true, args: ["--no-sandbox"] });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/about`)).ok) break; } catch { /* not up yet */ }
    if (i > 100) throw new Error("vite preview didn't start");
    await new Promise((r) => setTimeout(r, 200));
  }
  mkdirSync(`${root}prerender`, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  for (const [name, path] of Object.entries(PAGES)) {
    // vite preview falls back to index.html, and the app routes by pathname, so the bare path renders the page.
    await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "networkidle0", timeout: 90_000 });
    await page.waitForSelector("h1", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1500));
    // Plain text only: headings, paragraphs, list items and links, in reading order. Scenes and styling stay out.
    const html = await page.evaluate(() => {
      const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const attr = (t) => esc(t).replace(/"/g, "&quot;");
      const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
      const out = [];
      const seen = new Set();
      for (const el of document.querySelectorAll("#root h1, #root h2, #root h3, #root p, #root li, #root a")) {
        if (el.closest(".react-flow, button, [aria-hidden='true']")) continue;
        // A link inside a heading, paragraph or list item is written with it.
        if (el.tagName === "A" && el.parentElement?.closest("h1, h2, h3, p, li")) continue;
        const t = text(el);
        if (!t || seen.has(el.tagName + t)) continue;
        seen.add(el.tagName + t);
        const inline = (node) => [...node.childNodes].map((c) =>
          c.nodeType === 3 ? esc(c.textContent.replace(/\s+/g, " "))
            : c.tagName === "A" && c.getAttribute("href") ? `<a href="${attr(c.getAttribute("href"))}">${esc(text(c))}</a>`
              : c.nodeType === 1 ? inline(c) : "").join("");
        const tag = el.tagName.toLowerCase();
        if (tag === "a") { const href = el.getAttribute("href"); if (href) out.push(`<p><a href="${attr(href)}">${esc(t)}</a></p>`); continue; }
        out.push(`<${tag}>${inline(el).replace(/\s+/g, " ").trim()}</${tag}>`);
      }
      return out.join("\n");
    });
    writeFileSync(`${root}prerender/${name}.html`, html + "\n");
    console.log(`prerender/${name}.html  ${(html.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  server.kill();
}
