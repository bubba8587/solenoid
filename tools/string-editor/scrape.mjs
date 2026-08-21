// Scrape the RUNNING Solenoid dev server for visible, human-readable text runs.
// Launches the preinstalled Chromium via playwright-core (never starts the dev server).

import { chromium } from 'playwright-core';

const CHROME_EXEC = process.env.SOLENOID_CHROME
  || 'C:/Users/build/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const APP_URL = process.env.SOLENOID_APP_URL || 'http://localhost:1420';

// Runs inside the page. Collect visible text nodes with light context.
function collectInPage() {
  const isVisible = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const shortPath = (el) => {
    const parts = [];
    let cur = el;
    for (let d = 0; cur && d < 4; d++) {
      let seg = cur.tagName.toLowerCase();
      const cls = typeof cur.className === 'string' ? cur.className.trim().split(/\s+/)[0] : '';
      if (cls) seg += '.' + cls;
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue;
    if (!raw) continue;
    const t = raw.trim();
    if (!t) continue;
    const el = node.parentElement;
    if (!el) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
    if (!isVisible(el)) continue;
    out.push({
      text: t,
      tag,
      cls: typeof el.className === 'string' ? el.className.trim() : '',
      path: shortPath(el),
      data: (() => {
        const d = {};
        for (const a of el.attributes) if (a.name.startsWith('data-')) d[a.name] = a.value;
        return d;
      })(),
    });
  }
  // Also grab useful attribute strings that render as UI (tooltips, placeholders,
  // aria labels, button titles) — these are prime copy-edit targets not in text nodes.
  const attrTargets = document.querySelectorAll('[title],[placeholder],[aria-label]');
  for (const el of attrTargets) {
    if (!isVisible(el)) continue;
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (v && v.trim()) out.push({ text: v.trim(), tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.trim() : '', path: shortPath(el), attr, data: {} });
    }
  }
  return out;
}

// Keep only strings a human would want to copy-edit.
function keep(text) {
  if (!text) return false;
  if (text.length < 2) return false;              // single glyphs / icons
  if (!/[A-Za-z]/.test(text)) return false;       // pure numbers / symbols / currency
  if (/^[\d\s.,:%$€£+\-/()]+$/.test(text)) return false; // numeric-ish values
  return true;
}

export async function scrapeStrings() {
  const browser = await chromium.launch({ executablePath: CHROME_EXEC, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
    await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
    // Give Rete / React a moment to render node cards.
    await page.waitForTimeout(2500);
    const raw = await page.evaluate(collectInPage);

    // Dedupe by text, merging occurrence contexts.
    const map = new Map();
    for (const r of raw) {
      if (!keep(r.text)) continue;
      const existing = map.get(r.text);
      if (existing) {
        existing.count++;
        if (existing.contexts.length < 6) existing.contexts.push(context(r));
      } else {
        map.set(r.text, { text: r.text, count: 1, contexts: [context(r)] });
      }
    }
    return [...map.values()];
  } finally {
    await browser.close();
  }
}

function context(r) {
  const bits = [];
  if (r.attr) bits.push('@' + r.attr);
  bits.push(r.path || r.tag);
  const dataKeys = Object.keys(r.data || {});
  if (dataKeys.length) bits.push(dataKeys.map((k) => `${k}=${r.data[k]}`).join(' '));
  return bits.join(' | ');
}
