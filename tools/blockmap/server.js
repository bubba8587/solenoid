// The board server: serves the UI, the board and the log, and streams every new event to open
// pages over server-sent events. It tails the log file, so events written by the CLI or the hooks
// (with no server involved) still reach the page within a second. Zero dependencies.
//
// Each streamed batch carries the log's byte offset after it as its event id, so a page that reconnects
// (the browser sends the last id it saw) gets exactly what it missed, in the log's order.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore, findBoardDir, parseLines } from './core/store.js';
import { reduce, makeEvent, HUMAN, SYSTEM } from './core/model.js';
import { worktreeSnapshot, landed, changedBetween } from './core/worktrees.js';
import { agentForWorktree } from './core/merges.js';

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

// Without a token the board answers only to this machine: it binds a loopback address, and a request whose Host
// names anything else (another site's page reaching it through DNS rebinding) is turned away.
export function isLoopbackBind(host) {
  return ['localhost', '::1', '[::1]'].includes(String(host).toLowerCase()) || /^127\.\d+\.\d+\.\d+$/.test(host);
}
export function isLoopbackHostHeader(header) {
  const m = /^(\[[^\]]*\]|[^:\[\]]+)(?::\d+)?$/.exec(String(header || ''));
  return !!m && ['localhost', '127.0.0.1', '[::1]'].includes(m[1].toLowerCase());
}

export async function serve({ port = 4477, host = '127.0.0.1', open = false, demo = false, quiet = false } = {}) {
  const token = process.env.BLOCKMAP_TOKEN || '';
  if (!isLoopbackBind(host) && !token) {
    throw new Error(`Serving on ${host} would let anyone who can reach it change the board. Set BLOCKMAP_TOKEN, or serve on 127.0.0.1.`);
  }
  if (demo) {
    process.env.BLOCKMAP_LIVE = fs.mkdtempSync(path.join(os.tmpdir(), 'blockmap-demo-'));
  }
  const store = openStore(findBoardDir());
  let board = store.board({ items: true, files: true, samples: 14 });
  // The log as the page sees it: the events, and the byte offset just past each one's line.
  let events = [];
  let ends = [];
  let lineEnd = 0;
  const clients = new Set();
  const timers = [];
  const closers = [];
  const every = (fn, ms) => {
    const t = setInterval(fn, ms);
    t.unref();
    timers.push(t);
  };

  const send = (res, type, data, id) => res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (type, data, id) => {
    for (const res of clients) send(res, type, data, id);
  };

  // Reads the log from byte `from` to its last whole line: the events, each one's end offset, and where it stopped.
  function readFrom(from) {
    let fd;
    try {
      fd = fs.openSync(store.eventsPath, 'r');
    } catch {
      return { list: [], at: [], end: from };
    }
    try {
      const total = fs.fstatSync(fd).size;
      if (total <= from) return { list: [], at: [], end: from };
      const buf = Buffer.alloc(total - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      const stop = buf.lastIndexOf(10) + 1;
      const list = [];
      const at = [];
      for (let pos = 0; pos < stop; ) {
        const nl = buf.indexOf(10, pos);
        const [e] = parseLines(buf, pos, nl);
        if (e) {
          list.push(e);
          at.push(from + nl + 1);
        }
        pos = nl + 1;
      }
      return { list, at, end: from + stop };
    } finally {
      fs.closeSync(fd);
    }
  }

  function reload() {
    const r = readFrom(0);
    events = r.list;
    ends = r.at;
    lineEnd = r.end;
  }
  reload();

  function poll() {
    const now = size(store.eventsPath);
    if (now < lineEnd) {
      reload();
      broadcast('reset', { events }, lineEnd);
      return;
    }
    if (now === lineEnd) return;
    const r = readFrom(lineEnd);
    if (r.end === lineEnd) return;
    lineEnd = r.end;
    if (r.list.length) {
      events.push(...r.list);
      ends.push(...r.at);
      broadcast('events', r.list, lineEnd);
    }
  }

  // The events after a byte offset a page last saw, or null when the offset is past this log's end (it was
  // cut short or replaced since).
  function since(offset) {
    if (offset > lineEnd) return null;
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] <= offset) lo = mid + 1;
      else hi = mid;
    }
    return events.slice(lo);
  }

  fs.mkdirSync(store.live, { recursive: true });
  let pending = null;
  const kick = () => {
    clearTimeout(pending);
    pending = setTimeout(poll, 40);
    pending.unref();
  };
  try {
    const w = fs.watch(store.live, kick);
    w.unref();
    closers.push(() => w.close());
  } catch {
    // Polling below covers file systems without watch.
  }
  every(poll, 1000);

  const watched = [store.boardPath, ...board.sources.filter((s) => s.file).map((s) => path.join(store.home, s.file))];
  const reloadBoard = () => {
    try {
      board = store.board({ items: true, files: true, samples: 14 });
      broadcast('board', board);
    } catch (err) {
      broadcast('problem', { message: `The board config didn't load: ${err.message}` });
    }
  };
  for (const f of watched) {
    try {
      fs.watchFile(f, { interval: 1500 }, reloadBoard).unref();
      closers.push(() => fs.unwatchFile(f, reloadBoard));
    } catch {
      // A missing source just never reloads.
    }
  }
  every(() => broadcast('ping', { ts: Date.now() }), 20_000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!token && !isLoopbackHostHeader(req.headers.host)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        return res.end('This board answers only on localhost. Set BLOCKMAP_TOKEN to serve it to other machines.');
      }
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
      poll();
      const after = Number(url.searchParams.get('since') || 0);
      return json(res, 200, after ? events.filter((e) => e.ts > after) : events, { 'x-blockmap-offset': String(lineEnd) });
    }
    if (req.method === 'GET' && url.pathname === '/api/worktrees') return json(res, 200, worktrees || { base: '', at: 0, list: [] });
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      poll();
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      send(res, 'hello', { count: events.length, demo });
      // Resume where the page left off: the last id the browser saw, else the offset its first read ended at.
      const from = req.headers['last-event-id'] ?? url.searchParams.get('from');
      if (from !== undefined && from !== null && from !== '') {
        const missed = /^\d+$/.test(from) ? since(Number(from)) : null;
        if (missed === null) send(res, 'reset', { events }, lineEnd);
        else if (missed.length) send(res, 'events', missed, lineEnd);
      }
      if (worktrees) send(res, 'worktrees', worktrees);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    if (req.method === 'POST' && url.pathname === '/api/commit') {
      // A custom header keeps other sites' pages from posting here: a cross-origin request
      // carrying it needs a preflight this server never answers.
      if (req.headers['x-blockmap'] !== '1') return json(res, 403, { error: 'Send the x-blockmap: 1 header.' });
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return json(res, 400, { error: 'The body is not JSON.' });
      }
      if (!Array.isArray(body?.events)) return json(res, 400, { error: 'Send { "events": [...] }.' });
      const state = store.state();
      const now = Date.now();
      // The server stamps every event's id and time itself; `by` is kept, and checked as an id like the rest.
      const prepared = body.events.map((raw) => {
        const { id, ts, type, by, ...rest } = raw && typeof raw === 'object' ? raw : {};
        const e = makeEvent(state, type, by || HUMAN, rest, now);
        if (e.type === 'merge.ready' && e.ahead === undefined) {
          const wt = worktrees?.list.find((w) => w.name === e.worktree);
          if (wt) e.ahead = wt.ahead;
        }
        return e;
      });
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

  // Worktrees, read from git every few seconds. Edits in a worktree whose agent never talks to the board
  // are recorded for it all the same (a stand-in agent named after the worktree), so any agent on any
  // model shows up; a queued branch is marked landed once its commit is in the base.
  let worktrees = null;
  let seen = new Map();
  let polling = false;
  async function pollWorktrees() {
    if (polling) return;
    polling = true;
    try {
      const state = store.state();
      const snap = demo && demoSim ? demoSim.worktrees(state, Date.now()) : await worktreeSnapshot(store.root, { base: board.base });
      const now = Date.now();
      const fresh = [];
      for (const wt of snap.list) wt.agent = agentForWorktree(state, wt);
      const { next, changes } = demo ? { next: seen, changes: [] } : await gitEdits(seen, snap.list, { mtime: mtimeOf, headDiff: changedBetween });
      for (const { wt, files: changed } of changes) {
        let agent = wt.agent;
        if (!agent) {
          agent = `wt-${wt.name}`;
          fresh.push(makeEvent(state, 'agent.join', agent, { agent: { id: agent, name: wt.name, kind: 'worktree', worktree: wt.path } }, now));
          wt.agent = agent;
        }
        // Edits the agent's own hooks already reported in the last half minute aren't counted twice.
        const recent = new Set((state.agents[agent]?.touches || []).filter((t) => now - t.ts < 30_000).map((t) => t.file));
        const files = changed.filter((f) => !recent.has(f));
        if (files.length) fresh.push(makeEvent(state, 'touch', agent, { files, op: 'edit', src: 'git' }, now));
      }
      for (const m of Object.values(state.merges)) {
        // A branch marked ready with nothing ahead of the base is already "in" it; only real work lands.
        if (m.status !== 'ready' || !m.commit || demo || !(m.ahead > 0)) continue;
        if (await landed(store.root, m.commit, board.base)) fresh.push(makeEvent(state, 'merge.landed', SYSTEM, { worktree: m.worktree, commit: m.commit }, now));
      }
      // The file times move forward only once what they showed is in the log; a write that fails is seen again.
      if (commitEach(fresh, now)) seen = next;
      else seen = new Map([...next].map(([k, v]) => [k, changes.some((c) => c.wt.path === k) ? seen.get(k) : v]).filter(([, v]) => v));
      worktrees = snap;
      broadcast('worktrees', snap);
    } catch (err) {
      broadcast('problem', { message: `Reading the worktrees failed: ${err.message}` });
    } finally {
      polling = false;
    }
  }
  // Commits the batch, or, if the rules refuse part of it, each event the rules accept. False when the log
  // couldn't be written at all.
  function commitEach(list, now) {
    if (!list.length) return true;
    try {
      store.commit(list, now);
    } catch (err) {
      if (!err.refused) return false;
      for (const e of list) {
        try {
          store.commit([e], now);
        } catch (one) {
          if (!one.refused) return false;
        }
      }
    }
    poll();
    return true;
  }
  let demoSim = null;
  if (demo) demoSim = await startDemo(store, () => board, every);
  pollWorktrees();
  every(pollWorktrees, Number(process.env.BLOCKMAP_WORKTREE_MS || 4000));

  // Closing stops the polls and watchers and ends the open streams, so the process can exit.
  const close = server.close.bind(server);
  server.close = (cb) => {
    for (const t of timers) clearInterval(t);
    clearTimeout(pending);
    for (const c of closers) c();
    for (const res of clients) res.end();
    clients.clear();
    return close(cb);
  };
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const where = `http://${isLoopbackBind(host) ? host.replace(/^::1$/, '[::1]') : 'localhost'}:${server.address().port}`;
  if (!quiet) {
    console.log(`Blockmap: ${board.name} board at ${where}${demo ? ' (demo: simulated agents, a throwaway log)' : ''}`);
    console.log(`Log: ${store.eventsPath}`);
  }
  if (open) openBrowser(where);
  return server;
}

function mtimeOf(dir, file) {
  try {
    return fs.statSync(path.join(dir, file)).mtimeMs;
  } catch {
    return -1;
  }
}

// The files git shows changed in each linked worktree since the last recorded poll. `seen` maps a worktree's
// path to the HEAD and file times that poll saw; the result's `next` is what to remember once the edits are in
// the log. A worktree seen for the first time is only remembered (its existing changes aren't edits happening
// now), and when HEAD moved (a commit, checkout, rebase or reset) a file that differs between the two HEADs
// changed because git rewrote it, so it isn't reported either.
export async function gitEdits(seen, list, { mtime = mtimeOf, headDiff = changedBetween } = {}) {
  const next = new Map();
  const changes = [];
  for (const wt of list) {
    if (wt.main) continue;
    const files = new Map(wt.files.map((f) => [f, mtime(wt.path, f)]));
    next.set(wt.path, { head: wt.head, files });
    const prev = seen.get(wt.path);
    if (!prev) continue;
    const moved = prev.head === wt.head ? new Set() : await headDiff(wt.path, prev.head, wt.head);
    const changed = [];
    for (const [f, m] of files) {
      if (prev.files.get(f) === m) continue;
      if (!moved || moved.has(f)) continue;
      changed.push(f);
    }
    if (changed.length) changes.push({ wt, files: changed });
  }
  return { next, changes };
}

async function startDemo(store, getBoard, every) {
  const { createSim } = await import('./ui/sim.js');
  const sim = createSim(getBoard(), { seed: 7 });
  const now = Date.now();
  if (!store.readEvents().length) {
    const history = sim.history(now - 3 * 3600_000, now);
    fs.mkdirSync(store.live, { recursive: true });
    fs.writeFileSync(store.eventsPath, history.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  every(() => {
    // The crew applies its moves to the state it is given, so it gets a fold of its own.
    const state = reduce(getBoard(), store.readEvents());
    for (const e of sim.step(state, Date.now())) {
      try {
        store.commit([e]);
      } catch {
        // The simulation proposes; the rules decide.
      }
    }
  }, 1600);
  return sim;
}

function size(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store', ...headers });
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
