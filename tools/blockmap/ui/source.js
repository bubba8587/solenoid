// Where the page's events come from: the live board server when the page is served by
// `bm serve`, or a simulated crew on a snapshot of the board when it's opened anywhere else.

import { apply, checkEvent, createState, makeEvent } from '../core/model.js';
import { createSim } from './sim.js';

export async function connect({ onBoard, onEvents, onReset, onStatus, onWorktrees }) {
  const token = new URLSearchParams(location.search).get('token');
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  // The board server marks the pages it serves; anywhere else there is no API to ask.
  const served = !!document.querySelector('meta[name="blockmap"][content="server"]');
  const live = served ? await tryLive(q, { onBoard, onEvents, onReset, onStatus, onWorktrees }) : null;
  if (live) return live;
  return demo({ onEvents, onStatus, onWorktrees });
}

// The page takes events from the stream only, in the log's order; a commit just waits for its own events to come
// back on it. Each batch's id is the log's byte offset after it, so a dropped stream resumes exactly where it
// left off (the browser sends the last id it saw; before any, the offset the first read ended at).
async function tryLive(q, { onBoard, onEvents, onReset, onStatus, onWorktrees }) {
  let board;
  let events;
  let from = null;
  try {
    const res = await fetch(`api/board${q}`, { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    board = await res.json();
    const log = await fetch(`api/events${q}`, { cache: 'no-store' });
    from = log.headers.get('x-blockmap-offset');
    events = await log.json();
  } catch {
    return null;
  }
  const seen = new Set(events.map((e) => e.id));
  const waiting = new Map();
  const arrived = (list) => {
    for (const e of list) {
      const done = waiting.get(e.id);
      if (done) {
        waiting.delete(e.id);
        done();
      }
    }
  };
  const take = (list) => {
    const fresh = list.filter((e) => !seen.has(e.id));
    for (const e of fresh) seen.add(e.id);
    if (fresh.length) onEvents(fresh);
    arrived(list);
  };
  const es = new EventSource(`api/stream${q}${from !== null ? `${q ? '&' : '?'}from=${encodeURIComponent(from)}` : ''}`);
  es.addEventListener('hello', () => onStatus('live'));
  es.addEventListener('events', (m) => take(JSON.parse(m.data)));
  es.addEventListener('board', (m) => onBoard(JSON.parse(m.data)));
  es.addEventListener('worktrees', (m) => onWorktrees(JSON.parse(m.data)));
  es.addEventListener('reset', (m) => {
    const list = JSON.parse(m.data).events;
    seen.clear();
    for (const e of list) seen.add(e.id);
    onReset(list);
    arrived(list);
  });
  es.addEventListener('problem', (m) => onStatus('problem', JSON.parse(m.data).message));
  es.onerror = () => onStatus('offline');
  return {
    mode: 'live',
    board,
    events,
    async commit(list) {
      const res = await fetch(`api/commit${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-blockmap': '1' },
        body: JSON.stringify({ events: list }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The board answered ${res.status}.`);
      const accepted = body.accepted || [];
      // Resolves once the stream has delivered them (it was sent before this answer), or after a few seconds.
      const pending = accepted.filter((e) => !seen.has(e.id)).map((e) => new Promise((done) => waiting.set(e.id, done)));
      let timer;
      await Promise.race([Promise.all(pending), new Promise((done) => (timer = setTimeout(done, 4000)))]);
      clearTimeout(timer);
      for (const e of accepted) waiting.delete(e.id);
      return accepted;
    },
  };
}

async function demo({ onEvents, onStatus, onWorktrees }) {
  const res = await fetch('demo/board.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('No board server answered and there is no demo/board.json beside this page.');
  const board = await res.json();
  const sim = createSim(board, { seed: 11 });
  const now = Date.now();
  const state = createState(board);
  const events = sim.history(now - 3 * 3600_000, now, state);
  onStatus('demo');
  setTimeout(() => onWorktrees(sim.worktrees(state, Date.now())), 0);
  setInterval(() => {
    const fresh = sim.step(state, Date.now());
    if (fresh.length) onEvents(fresh);
    onWorktrees(sim.worktrees(state, Date.now()));
  }, 1600);
  return {
    mode: 'demo',
    board,
    events,
    async commit(list) {
      const t = Date.now();
      const out = [];
      for (const raw of list) {
        const { type, by, ...rest } = raw;
        const e = makeEvent(state, type, by || 'human', rest, t);
        const why = checkEvent(state, e, t);
        if (why) throw new Error(why);
        apply(state, e);
        out.push(e);
      }
      onEvents(out);
      return out;
    },
  };
}
