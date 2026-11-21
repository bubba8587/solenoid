// The board server: serves the UI, the board and the log, and streams every new event to open
// pages over server-sent events. It tails the log file, so events written by the CLI or the hooks
// (with no server involved) still reach the page within a second. Zero dependencies.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore, findBoardDir } from './core/store.js';
import { reduce, makeEvent } from './core/model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const STATIC_ROOTS = ['ui', 'core', 'adapters'];

export function pageHtml(fragment) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="blockmap" content="server"></head><body>\n${fragment}\n</body></html>`;
}

export async function serve({ port = 4477, host = '127.0.0.1', open = false, demo = false } = {}) {
  if (demo) {
    process.env.BLOCKMAP_LIVE = fs.mkdtempSync(path.join(os.tmpdir(), 'blockmap-demo-'));
  }
  const store = openStore(findBoardDir());
  const token = process.env.BLOCKMAP_TOKEN || '';
  let board = store.board({ items: true, files: true, samples: 14 });
  let events = store.readEvents();
  let offset = size(store.eventsPath);
  let partial = '';
  const clients = new Set();

  const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (type, data) => {
    for (const res of clients) send(res, type, data);
  };

  function poll() {
    const now = size(store.eventsPath);
    if (now < offset) {
      events = store.readEvents();
      offset = now;
      partial = '';
      broadcast('reset', { events });
      return;
    }
    if (now === offset) return;
    const fd = fs.openSync(store.eventsPath, 'r');
    const buf = Buffer.alloc(now - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = now;
    const text = partial + buf.toString('utf8');
    const lines = text.split('\n');
    partial = lines.pop();
    const fresh = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        fresh.push(JSON.parse(line));
      } catch {
        // A torn line; the next write completes it or it was never whole.
      }
    }
    if (fresh.length) {
      events.push(...fresh);
      broadcast('events', fresh);
    }
  }

  fs.mkdirSync(store.live, { recursive: true });
  let pending = null;
  const kick = () => {
    clearTimeout(pending);
    pending = setTimeout(poll, 40);
  };
  try {
    fs.watch(store.live, kick);
  } catch {
    // Polling below covers file systems without watch.
  }
  setInterval(poll, 1000);

  const watched = [store.boardPath, ...board.sources.map((s) => path.join(store.root, s.file))];
  for (const f of watched) {
    try {
      fs.watchFile(f, { interval: 1500 }, () => {
        try {
          board = store.board({ items: true, files: true, samples: 14 });
          broadcast('board', board);
        } catch (err) {
          broadcast('problem', { message: `The board config didn't load: ${err.message}` });
        }
      });
    } catch {
      // A missing source just never reloads.
    }
  }
  setInterval(() => broadcast('ping', { ts: Date.now() }), 20_000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (token && req.headers.authorization !== `Bearer ${token}` && url.searchParams.get('token') !== token) return json(res, 401, { error: 'This board needs its token.' });
        return await api(req, res, url);
      }
      return serveStatic(res, url.pathname);
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });

  async function api(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/board') return json(res, 200, board);
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const since = Number(url.searchParams.get('since') || 0);
      return json(res, 200, since ? events.filter((e) => e.ts > since) : events);
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      send(res, 'hello', { count: events.length, demo });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    if (req.method === 'POST' && url.pathname === '/api/commit') {
      // A custom header keeps other sites' pages from posting here: a cross-origin request
      // carrying it needs a preflight this server never answers.
      if (req.headers['x-blockmap'] !== '1') return json(res, 403, { error: 'Send the x-blockmap: 1 header.' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const state = reduce(board, store.readEvents());
      const now = Date.now();
      const prepared = (body.events || []).map((e) => (e.id && e.ts ? e : makeEvent(state, e.type, e.by || 'human', strip(e), now)));
      try {
        const { events: accepted } = store.commit(prepared, now);
        poll();
        return json(res, 200, { accepted });
      } catch (err) {
        return json(res, err.refused ? 409 : 500, { error: err.message });
      }
    }
    return json(res, 404, { error: 'No such route.' });
  }

  function serveStatic(res, pathname) {
    if (pathname === '/' || pathname === '/index.html') {
      const html = fs.readFileSync(path.join(HERE, 'ui', 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(pageHtml(html));
    }
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    const top = rel.split('/')[0];
    const file = path.resolve(HERE, rel);
    if (!STATIC_ROOTS.includes(top) || !file.startsWith(HERE + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
    return undefined;
  }

  if (demo) startDemo(store, () => board);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const where = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  console.log(`Blockmap: ${board.name} board at ${where}${demo ? ' (demo: simulated agents, a throwaway log)' : ''}`);
  console.log(`Log: ${store.eventsPath}`);
  if (open) openBrowser(where);
  return server;
}

async function startDemo(store, getBoard) {
  const { createSim } = await import('./ui/sim.js');
  const sim = createSim(getBoard(), { seed: 7 });
  const now = Date.now();
  if (!store.readEvents().length) {
    const history = sim.history(now - 3 * 3600_000, now);
    fs.mkdirSync(store.live, { recursive: true });
    fs.writeFileSync(store.eventsPath, history.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  setInterval(() => {
    const state = reduce(getBoard(), store.readEvents());
    for (const e of sim.step(state, Date.now())) {
      try {
        store.commit([e]);
      } catch {
        // The simulation proposes; the rules decide.
      }
    }
  }, 1600);
}

function strip(e) {
  const { type, by, ...rest } = e;
  return rest;
}

function size(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('Body too large.'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // No browser to open; the URL is printed above.
  }
}
