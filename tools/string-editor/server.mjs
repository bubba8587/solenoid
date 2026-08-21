// Solenoid String Editor — a local WYSIWYG copy-editing companion.
//
// Open http://localhost:5599 in its own browser window. It scrapes the RUNNING
// dev server (http://localhost:1420), lists every visible string, maps each back
// to a source literal, and lets you rewrite that literal in place. Vite HMR then
// reflects the change live in the app.
//
//   node server.mjs        (or: npm start)

import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeStrings } from './scrape.mjs';
import { buildIndex, findMatches, applyEdit, REPO_ROOT } from './literals.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5599;
const SRC_DIR = path.join(REPO_ROOT, 'src');

// --- list src/**/*.{ts,tsx,md} ------------------------------------------------
async function listSourceFiles() {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
        await walk(full);
      } else if (/\.(ts|tsx|md)$/.test(e.name)) {
        out.push(full);
      }
    }
  }
  await walk(SRC_DIR);
  return out;
}

// --- API handlers -------------------------------------------------------------
async function handleScan() {
  const [scraped, index] = await Promise.all([scrapeStrings(), buildIndex(listSourceFiles)]);
  const items = scraped.map((s) => {
    const matches = findMatches(index, s.text);
    let status;
    if (matches.length === 0) status = 'not-found';
    else if (matches.length === 1) status = 'unique';
    else status = 'ambiguous';
    return {
      text: s.text,
      count: s.count,
      contexts: s.contexts,
      status,
      matches: matches.map((m) => ({
        kind: m.kind, file: m.file, abs: m.abs, line: m.line,
        start: m.start, end: m.end, quote: m.quote, raw: m.raw,
      })),
    };
  });
  // Editable (unique/ambiguous) first, then not-found; alpha within.
  const rank = { unique: 0, ambiguous: 1, 'not-found': 2 };
  items.sort((a, b) => (rank[a.status] - rank[b.status]) || a.text.localeCompare(b.text));
  return { count: items.length, fileCount: index.fileCount, items };
}

async function handleSave(body) {
  const { abs, start, end, quote, raw, kind, newText, fromText, status, context } = body;
  if (typeof newText !== 'string') throw new Error('newText required');
  if (!abs || !abs.startsWith(SRC_DIR)) throw new Error('refusing to edit outside src/');
  const result = await applyEdit({ abs, start, end, quote, raw, kind, newText, fromText, status, context });
  return { ok: true, ...result };
}

// --- server -------------------------------------------------------------------
function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(path.join(HERE, 'ui.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/scan') {
      const data = await handleScan();
      send(res, 200, data);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/save') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      const data = await handleSave(body);
      send(res, 200, data);
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Solenoid String Editor running`);
  console.log(`  Open  ->  http://localhost:${PORT}`);
  console.log(`  App   ->  http://localhost:1420 (must be running)\n`);
});
