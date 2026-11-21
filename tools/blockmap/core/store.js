// The local store: the board config (`.blockmap/board.json`, committed) and the live log
// (`.blockmap/live/events.jsonl`, ignored by git). Node only.
//
// Every write goes through `commit`, which takes a lock, brings the fold up to the end of the log, checks
// each event against that state and appends, so two agents racing for one block can't both win.
// Worktrees of one repository share the main checkout's board and live log.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createState, apply, checkEvent, makeEvent } from './model.js';
import { resolveBoard } from './resolve.js';

// Where a directory sits in git, read from the files git keeps rather than by running git: the checkout's top,
// the repository's common git dir, and whether the checkout is a linked worktree.
export function gitLayout(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const dotgit = path.join(dir, '.git');
    let st = null;
    try {
      st = fs.statSync(dotgit);
    } catch {
      // Not here; look further up.
    }
    if (st?.isDirectory()) return { top: dir, common: dotgit, linked: false };
    if (st?.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(readOr(dotgit, ''));
      if (!m) return null;
      const gitDir = path.resolve(dir, m[1]);
      const commondir = readOr(path.join(gitDir, 'commondir'), '').trim();
      // A worktree's git dir names the common one; a submodule's has none and is its own repository.
      const common = commondir ? path.resolve(gitDir, commondir) : gitDir;
      return { top: dir, common, linked: !!commondir };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function readOr(file, fallback) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

// The main checkout's board, for a directory inside a linked worktree of that repository.
function mainBoardOf(dir) {
  const g = gitLayout(dir);
  if (!g || path.basename(g.common) !== '.git') return null;
  const board = path.join(path.dirname(g.common), '.blockmap');
  return fs.existsSync(path.join(board, 'board.json')) ? { board, checkout: g.top, linked: g.linked } : null;
}

export function findBoardDir(start = process.cwd()) {
  if (process.env.BLOCKMAP_DIR) return path.resolve(process.env.BLOCKMAP_DIR);
  // A linked worktree folds the shared log over the main checkout's board, not its own branch's copy: a block
  // that exists on one branch only would otherwise be invisible from the others.
  const main = mainBoardOf(start);
  if (main?.linked) return main.board;
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.blockmap', 'board.json'))) return path.join(dir, '.blockmap');
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return main?.board || null;
}

function liveDirFor(boardDir) {
  if (process.env.BLOCKMAP_LIVE) return path.resolve(process.env.BLOCKMAP_LIVE);
  // A worktree's own copy of the board still writes to the main checkout's log.
  const main = mainBoardOf(path.dirname(boardDir));
  return path.join(main ? main.board : boardDir, 'live');
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// A lock whose holder is still running is never broken unless it is this old (a stopped or hung process).
const LOCK_MAX_MS = 60_000;
// A lock file with nothing readable in it (being written this instant, or a folder from an older Blockmap).
const LOCK_BLANK_MS = 10_000;
// The tail of the log a fold remembers, to tell an appended log from one rewritten under it.
const MARK = 64;

export function openStore(boardDir = findBoardDir(), { cwd = process.cwd(), lockWaitMs = 8000 } = {}) {
  if (!boardDir) throw new Error('No .blockmap/board.json here or in any folder above. `bm init` makes one.');
  // `home` holds the board and its item sources; `root` is the checkout paths are relative to, which in a linked
  // worktree of the same repository is that worktree.
  const home = path.dirname(boardDir);
  const here = mainBoardOf(cwd);
  const root = here?.linked && path.dirname(here.board) === home ? here.checkout : home;
  const live = liveDirFor(boardDir);
  const eventsPath = path.join(live, 'events.jsonl');
  const boardPath = path.join(boardDir, 'board.json');
  const lockPath = path.join(live, '.lock');

  function readConfig() {
    return JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  }

  // Every whole line of the log. A line still being written (no newline yet) isn't an event yet, and a torn
  // line from a crashed writer is skipped.
  function readEvents() {
    let buf;
    try {
      buf = fs.readFileSync(eventsPath);
    } catch {
      return [];
    }
    return parseLines(buf, 0, buf.lastIndexOf(10) + 1);
  }

  function withLock(fn) {
    fs.mkdirSync(live, { recursive: true });
    const nonce = crypto.randomBytes(9).toString('hex');
    const mine = JSON.stringify({ pid: process.pid, host: os.hostname(), nonce, ts: Date.now() });
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      try {
        fs.writeFileSync(lockPath, mine, { flag: 'wx' });
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        if (breakIfStale()) continue;
        if (Date.now() > deadline) throw new Error(`The board is locked (${lockPath}) by a process that is still running. If no bm command or hook is, delete that file.`);
        pause(10);
      }
    }
    try {
      return fn();
    } finally {
      // Only ever this writer's own lock: one broken as stale and taken by another writer stays theirs.
      if (lockInfo()?.nonce === nonce) fs.rmSync(lockPath, { force: true });
    }
  }

  function lockInfo() {
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      return null;
    }
  }

  // Removes the lock when its holder is gone (a dead process on this machine) or it is very old, and says
  // whether it did. It is moved aside before it is removed, so a lock taken in the meantime is put back.
  function breakIfStale() {
    let st;
    try {
      st = fs.statSync(lockPath);
    } catch {
      return true;
    }
    const info = lockInfo();
    const age = Date.now() - st.mtimeMs;
    const stale = info?.pid ? age > LOCK_MAX_MS || (info.host === os.hostname() && !alive(info.pid)) : age > LOCK_BLANK_MS;
    if (!stale) return false;
    const aside = `${lockPath}.stale-${crypto.randomBytes(6).toString('hex')}`;
    try {
      fs.renameSync(lockPath, aside);
    } catch {
      return true;
    }
    let moved = null;
    try {
      moved = JSON.parse(fs.readFileSync(aside, 'utf8'));
    } catch {
      // A folder or a blank file: nothing to put back.
    }
    if (moved?.nonce && moved.nonce !== info?.nonce) {
      try {
        fs.linkSync(aside, lockPath);
      } catch {
        // Yet another writer holds it now.
      }
    }
    fs.rmSync(aside, { recursive: true, force: true });
    return true;
  }

  // The resolved board, rebuilt when the config or an item source changes on disk.
  let boardCache = null;
  let boardKey = '';
  function board(opts) {
    if (opts) return resolveBoard({ root: home, readConfig }, opts);
    const key = sourceStamp();
    if (!boardCache || key !== boardKey) {
      boardCache = resolveBoard({ root: home, readConfig }, { items: true, files: false });
      boardKey = key;
    }
    return boardCache;
  }
  function sourceStamp() {
    const files = [boardPath];
    try {
      for (const s of readConfig().sources || []) if (s.file) files.push(path.join(home, s.file));
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

  // The fold, kept current: the state at a byte offset of the log, moved forward by reading only what was
  // appended since. A new board, or a log that shrank or changed below that offset, folds from the start.
  let fold = null;
  function current() {
    const b = board();
    let fd;
    try {
      fd = fs.openSync(eventsPath, 'r');
    } catch {
      fold = { board: b, state: createState(b), offset: 0, mark: '' };
      return fold.state;
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (!fold || fold.board !== b || size < fold.offset || readMark(fd, fold.offset) !== fold.mark) {
        fold = { board: b, state: createState(b), offset: 0, mark: '' };
      }
      if (size > fold.offset) {
        const buf = Buffer.alloc(size - fold.offset);
        fs.readSync(fd, buf, 0, buf.length, fold.offset);
        const end = buf.lastIndexOf(10) + 1;
        for (const e of parseLines(buf, 0, end)) apply(fold.state, e);
        fold.offset += end;
        fold.mark = readMark(fd, fold.offset);
      }
      return fold.state;
    } finally {
      fs.closeSync(fd);
    }
  }

  function endsInNewline() {
    let fd;
    try {
      fd = fs.openSync(eventsPath, 'r');
    } catch {
      return true;
    }
    try {
      const size = fs.fstatSync(fd).size;
      if (!size) return true;
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, size - 1);
      return b[0] === 10;
    } finally {
      fs.closeSync(fd);
    }
  }

  return {
    kind: 'local',
    boardDir,
    home,
    root,
    live,
    eventsPath,
    boardPath,
    lockPath,
    readConfig,
    readEvents,
    board,
    withLock,
    load() {
      const b = board();
      return { board: b, events: readEvents() };
    },
    // The state at the end of the log. It is shared and kept current by later calls: read it, don't change it.
    state() {
      return current();
    },
    // Check and append events atomically. Throws with the first refusal's reason.
    commit(events, now = Date.now()) {
      return withLock(() => {
        fs.mkdirSync(live, { recursive: true });
        // A crashed writer can leave half a line; ending it here keeps the next event on a line of its own.
        if (!endsInNewline()) fs.appendFileSync(eventsPath, '\n');
        const fresh = current();
        const ok = [];
        try {
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
            const text = ok.map((e) => JSON.stringify(e)).join('\n') + '\n';
            fs.appendFileSync(eventsPath, text);
            fold.offset += Buffer.byteLength(text);
            fold.mark = markOf(fold.offset);
          }
        } catch (err) {
          // Events of this batch were applied to the shared fold but never written: fold again next time.
          if (ok.length || !err.refused) fold = null;
          throw err;
        }
        return { state: fresh, events: ok };
      });
    },
  };

  function markOf(offset) {
    const fd = fs.openSync(eventsPath, 'r');
    try {
      return readMark(fd, offset);
    } finally {
      fs.closeSync(fd);
    }
  }
}

function readMark(fd, offset) {
  const start = Math.max(0, offset - MARK);
  const buf = Buffer.alloc(offset - start);
  if (buf.length) fs.readSync(fd, buf, 0, buf.length, start);
  return buf.toString('latin1');
}

// The events on the whole lines of buf[from, to).
export function parseLines(buf, from, to) {
  const out = [];
  let pos = from;
  while (pos < to) {
    let nl = buf.indexOf(10, pos);
    if (nl < 0 || nl >= to) nl = to;
    if (nl > pos) {
      const line = buf.toString('utf8', pos, nl);
      if (line.trim()) {
        try {
          out.push(JSON.parse(line));
        } catch {
          // A torn line from a crashed writer: skip it, keep the rest.
        }
      }
    }
    pos = nl + 1;
  }
  return out;
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
