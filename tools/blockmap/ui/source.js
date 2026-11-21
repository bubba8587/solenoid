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

async function tryLive(q, { onBoard, onEvents, onReset, onStatus, onWorktrees }) {
  let board;
  let events;
  try {
    const res = await fetch(`api/board${q}`, { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    board = await res.json();
    events = await (await fetch(`api/events${q}`, { cache: 'no-store' })).json();
  } catch {
    return null;
  }
  let lastTs = events.length ? events[events.length - 1].ts : 0;
  const seen = new Set(events.map((e) => e.id));
  let opened = false;
  const take = (list) => {
    const fresh = list.filter((e) => !seen.has(e.id));
    for (const e of fresh) {
      seen.add(e.id);
      lastTs = Math.max(lastTs, e.ts);
    }
    if (fresh.length) onEvents(fresh);
  };
  const es = new EventSource(`api/stream${q}`);
  es.addEventListener('hello', async () => {
    onStatus('live');
    if (opened) {
      // Back after a drop: fetch whatever was written while the stream was down.
      try {
        take(await (await fetch(`api/events${q}${q ? '&' : '?'}since=${lastTs}`, { cache: 'no-store' })).json());
      } catch {
        // The next event will arrive on the stream anyway.
      }
    }
    opened = true;
  });
  es.addEventListener('events', (m) => take(JSON.parse(m.data)));
  es.addEventListener('board', (m) => onBoard(JSON.parse(m.data)));
  es.addEventListener('worktrees', (m) => onWorktrees(JSON.parse(m.data)));
  es.addEventListener('reset', (m) => {
    const list = JSON.parse(m.data).events;
    seen.clear();
    for (const e of list) seen.add(e.id);
    onReset(list);
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
      take(body.accepted || []);
      return body.accepted;
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
