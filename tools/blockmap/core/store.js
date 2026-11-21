// The local store: the board config (`.blockmap/board.json`, committed) and the live log
// (`.blockmap/live/events.jsonl`, ignored by git). Node only.
//
// Every write goes through `commit`, which takes a folder lock, folds the log fresh, checks each
// event against that state and appends, so two agents racing for one block can't both win.
// Worktrees of one repository share the main checkout's live log.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { reduce, apply, checkEvent, makeEvent } from './model.js';
import { resolveBoard } from './resolve.js';

export function findBoardDir(start = process.cwd()) {
  if (process.env.BLOCKMAP_DIR) return path.resolve(process.env.BLOCKMAP_DIR);
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.blockmap', 'board.json'))) return path.join(dir, '.blockmap');
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // A worktree whose branch predates the board still belongs to the main checkout's board.
  try {
    const common = path.resolve(start, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: start, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    const main = path.join(path.dirname(common), '.blockmap');
    if (fs.existsSync(path.join(main, 'board.json'))) return main;
  } catch {
    // Not in git.
  }
  return null;
}

function liveDirFor(boardDir) {
  if (process.env.BLOCKMAP_LIVE) return path.resolve(process.env.BLOCKMAP_LIVE);
  const root = path.dirname(boardDir);
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const common = path.resolve(root, out);
    const mainBoard = path.join(path.dirname(common), '.blockmap');
    if (path.basename(common) === '.git' && fs.existsSync(path.join(mainBoard, 'board.json'))) return path.join(mainBoard, 'live');
  } catch {
    // Not a git checkout: the board keeps its own live folder.
  }
  return path.join(boardDir, 'live');
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function openStore(boardDir = findBoardDir()) {
  if (!boardDir) throw new Error('No .blockmap/board.json here or in any folder above. `bm init` makes one.');
  const root = path.dirname(boardDir);
  const live = liveDirFor(boardDir);
  const eventsPath = path.join(live, 'events.jsonl');
  const boardPath = path.join(boardDir, 'board.json');

  function readConfig() {
    return JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  }

  function readEvents() {
    let text;
    try {
      text = fs.readFileSync(eventsPath, 'utf8');
    } catch {
      return [];
    }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A torn line from a crashed writer: skip it, keep the rest.
      }
    }
    return out;
  }

  function withLock(fn) {
    fs.mkdirSync(live, { recursive: true });
    const lock = path.join(live, '.lock');
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        fs.mkdirSync(lock);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) {
            fs.rmSync(lock, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) throw new Error(`The board is locked (${lock}). If no bm command is running, delete that folder.`);
        pause(15);
      }
    }
    try {
      return fn();
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }

  // The resolved board, rebuilt when the config or an item source changes on disk.
  let boardCache = null;
  let boardKey = '';
  function board(opts) {
    if (opts) return resolveBoard({ root, readConfig }, opts);
    const key = sourceStamp();
    if (!boardCache || key !== boardKey) {
      boardCache = resolveBoard({ root, readConfig }, { items: true, files: false });
      boardKey = key;
    }
    return boardCache;
  }
  function sourceStamp() {
    const files = [boardPath];
    try {
      for (const s of readConfig().sources || []) if (s.file) files.push(path.join(root, s.file));
    } catch {
      // A config that doesn't parse throws in readConfig below, with its own message.
    }
    return files.map((f) => {
      try {
        return fs.statSync(f).mtimeMs;
      } catch {
        return 0;
      }
    }).join('|');
  }

  return {
    kind: 'local',
    boardDir,
    root,
    live,
    eventsPath,
    boardPath,
    readConfig,
    readEvents,
    board,
    load() {
      const b = board();
      return { board: b, events: readEvents() };
    },
    state() {
      return reduce(board(), readEvents());
    },
    // Check and append events atomically. Throws with the first refusal's reason.
    commit(events, now = Date.now()) {
      return withLock(() => {
        const fresh = reduce(board(), readEvents());
        const ok = [];
        for (let e of events) {
          if (e.type === 'item.add' && fresh.items[e.item?.id]) e = makeEvent(fresh, e.type, e.by, { ...e, item: { ...e.item, id: undefined } }, e.ts);
          const why = checkEvent(fresh, e, now);
          if (why) {
            const err = new Error(why);
            err.refused = true;
            throw err;
          }
          apply(fresh, e);
          ok.push(e);
        }
        if (ok.length) {
          fs.mkdirSync(live, { recursive: true });
          fs.appendFileSync(eventsPath, ok.map((e) => JSON.stringify(e)).join('\n') + '\n');
        }
        return { state: fresh, events: ok };
      });
    },
  };
}

// The same surface over HTTP, for agents on another machine (`BLOCKMAP_URL`).
export function remoteStore(url, token = process.env.BLOCKMAP_TOKEN) {
  const base = url.replace(/\/$/, '');
  const headers = { 'content-type': 'application/json', 'x-blockmap': '1', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let cached = null;
  return {
    kind: 'remote',
    root: process.cwd(),
    async load() {
      if (cached) return cached;
      const [board, events] = await Promise.all([
        fetch(`${base}/api/board`, { headers }).then((r) => r.json()),
        fetch(`${base}/api/events`, { headers }).then((r) => r.json()),
      ]);
      cached = { board, events };
      return cached;
    },
    async state() {
      const { board, events } = await this.load();
      return reduce(board, events);
    },
    async commit(events) {
      const res = await fetch(`${base}/api/commit`, { method: 'POST', headers, body: JSON.stringify({ events }) });
      const body = await res.json();
      if (!res.ok) {
        const err = new Error(body.error || `The board answered ${res.status}.`);
        err.refused = res.status === 409;
        throw err;
      }
      const { board, events: before } = await this.load();
      cached.events = [...before, ...body.accepted];
      return { state: reduce(board, cached.events), events: body.accepted };
    },
  };
}
