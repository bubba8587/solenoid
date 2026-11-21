// The side column: a window per agent (its tray holds the blocks it reserved), the human's own
// window, and the Up next queue. Windows are drop targets; their trays are where tiles go.

import { HUMAN, presence, presenceSince, openQuestions, blockMeta, agentName, clock } from '../core/model.js';
import { h, icon, setHtml, setText, toggle, esc, timer } from './dom.js';
import { colorOf } from './map.js';

const RANK = { waiting: 0, working: 1, quiet: 1, blocked: 2, stale: 3, idle: 4, done: 5, gone: 6 };
const WORD = { working: 'Working', waiting: 'Needs you', blocked: 'Blocked', quiet: 'Quiet', stale: 'Gone quiet', idle: 'Idle', done: 'Done', gone: 'Left' };
const QUIET_MS = 5 * 60_000;
const MIN = 60_000;

export function createSide(ctx, root) {
  const wins = new Map();
  const row = h('div', { class: 'side-row' });
  const agentsHost = h('div', { style: { display: 'contents' } });
  const empty = h('div', { class: 'side-empty' });
  root.append(row, agentsHost, empty);

  function fixedWindow(key) {
    if (wins.has(key)) return wins.get(key);
    const drop = key === 'queue' ? 'queue' : `agent:${HUMAN}`;
    const tray = h('div', { class: 'tray', 'data-drop': drop });
    const name = h('div', { class: 'win-name' });
    const count = h('span', { class: 'win-count' });
    const el = h('section', { class: 'win compact plain', 'data-drop': drop, 'data-win': key }, h('div', { class: 'win-head' }, name, count), tray);
    row.append(el);
    const w = { el, tray, name, count };
    wins.set(key, w);
    return w;
  }

  function agentWindow(id) {
    if (wins.has(id)) return wins.get(id);
    const name = h('div', { class: 'win-name' });
    const state = h('span', { class: 'state' });
    const task = h('div', { class: 'win-task' });
    const doing = h('div', { class: 'win-doing' });
    const ask = h('div', { class: 'ask', hidden: true });
    const tray = h('div', { class: 'tray', 'data-drop': `agent:${id}` });
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const feed = h('ul', { class: 'feed' });
    const input = h('input', { class: 'field', id: `msg-${id}`, autocomplete: 'off', 'aria-label': 'Message' });
    const unread = h('span', { class: 'unread', hidden: true });
    const form = h('form', { class: 'msg' }, input, unread, h('button', { class: 'btn icon', type: 'submit', 'aria-label': 'Send', html: icon('send') }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      ctx.act.message(id, text).then((ok) => {
        if (ok) input.value = '';
      });
    });
    const el = h(
      'section',
      { class: 'win', 'data-drop': `agent:${id}`, 'data-win': id },
      h('div', { class: 'win-head' }, name, state),
      h('div', { class: 'win-body' }, task, doing, ask, tray, spark, feed, form),
    );
    const w = { el, name, state, task, doing, ask, tray, spark, feed, input, unread, askId: null };
    wins.set(id, w);
    return w;
  }

  function update() {
    const st = ctx.view;
    const now = ctx.viewNow;

    const q = fixedWindow('queue');
    setText(q.name, 'Up next');
    const queued = Object.values(st.blocks).filter((b) => b.queued && !b.holder).length;
    setText(q.count, queued || '');

    const hu = fixedWindow('human');
    setText(hu.name, st.agents[HUMAN].name);
    setText(hu.count, st.agents[HUMAN].held.length || '');
    hu.el.style.setProperty('--ac', 'var(--human)');

    const agents = Object.values(st.agents)
      .filter((a) => a.id !== HUMAN && (!a.leftAt || a.held.length || now - a.leftAt < 10 * MIN))
      .map((a) => {
        let p = presence(st, a.id, now);
        let since = presenceSince(st, a.id, now);
        if (p === 'working' && now - a.lastSeen > QUIET_MS) {
          p = 'quiet';
          since = a.lastSeen;
        }
        return { a, p, since };
      })
      .sort((x, y) => RANK[x.p] - RANK[y.p] || x.a.joinedAt - y.a.joinedAt);

    const keep = new Set(['queue', 'human']);
    for (const entry of agents) {
      keep.add(entry.a.id);
      paintAgent(st, now, agentWindow(entry.a.id), entry);
    }
    for (const [key, w] of wins) {
      if (keep.has(key)) continue;
      w.el.remove();
      wins.delete(key);
    }
    agents.forEach(({ a }, i) => {
      const el = wins.get(a.id).el;
      if (agentsHost.children[i] !== el) agentsHost.insertBefore(el, agentsHost.children[i] || null);
    });
    empty.hidden = agents.length > 0 || ctx.mode === 'demo';
    if (!agents.length) setHtml(empty, 'No agents yet. <code>tools/blockmap/bm join</code>, or <code>bm hooks install</code> to have Claude Code sessions join on their own.');
  }

  function paintAgent(st, now, w, { a, p, since }) {
    w.el.style.setProperty('--ac', colorOf(st, a.id));
    toggle(w.el, 'gone', p === 'gone');
    setText(w.name, a.name);
    w.name.title = [a.kind === 'claude-code' ? 'Claude Code' : a.kind, a.model, a.where, a.id].filter(Boolean).join('\n');
    w.state.className = `state ${p}`;
    const t =
      p === 'working' ? timer(since, { watch: true }, now)
      : p === 'waiting' ? timer(since, { warn: 5 * MIN, over: 15 * MIN }, now)
      : p === 'quiet' ? timer(since, { warn: 10 * MIN }, now)
      : p === 'stale' ? timer(since, { over: 2 * 60 * MIN }, now)
      : timer(since, {}, now);
    setHtml(w.state, `${WORD[p] || p} ${t}`);

    setText(w.task, a.task);
    w.task.hidden = !a.task;
    const doing = a.doing || (a.lastRun && now - a.lastRun.ts < 10 * MIN ? a.lastRun.cmd : '');
    setText(w.doing, doing);
    w.doing.hidden = !doing || p === 'gone';

    const qItem = openQuestions(st, a.id)[0];
    if (qItem) {
      if (w.askId !== qItem.id) {
        w.askId = qItem.id;
        w.ask.textContent = '';
        const field = h('input', { class: 'field', id: `answer-${a.id}`, autocomplete: 'off', 'aria-label': 'Answer' });
        const form = h('form', {}, field, h('button', { class: 'btn confirm', type: 'submit' }, 'Answer'));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (field.value.trim()) ctx.act.answer(qItem.id, field.value.trim());
        });
        w.ask.append(h('div', { class: 'q' }, h('span', {}, qItem.title), h('span', { class: 'qt' })), form);
      }
      setHtml(w.ask.querySelector('.qt'), timer(qItem.createdAt, { warn: 5 * MIN, over: 15 * MIN }, now));
      w.ask.hidden = false;
    } else {
      w.ask.hidden = true;
      w.askId = null;
    }

    paintSpark(w.spark, ctx.eventsOf(a.id), now);
    const lines = feedLines(st, ctx.eventsOf(a.id), now, 3);
    setHtml(w.feed, lines.map((l) => `<li class="k-${l.k}"><time>${clock(l.ts)}</time>${icon(l.icon)}<span class="t" title="${esc(l.text)}">${esc(l.text)}</span></li>`).join(''));
    w.unread.hidden = !a.inbox.length;
    setHtml(w.unread, a.inbox.length ? `${icon('mail')}${a.inbox.length}` : '');
    w.unread.title = a.inbox.length ? `${a.inbox.length} unread` : '';
    w.input.placeholder = `Message ${a.name}`;
    w.input.disabled = !!a.leftAt;
  }

  function paintSpark(svg, events, now) {
    const buckets = new Array(12).fill(0);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.ts > now) continue;
      const age = now - e.ts;
      if (age > 60 * MIN) break;
      if (e.type === 'touch' && e.op !== 'run') buckets[11 - Math.floor(age / (5 * MIN))]++;
    }
    const max = Math.max(3, ...buckets);
    const W = 160;
    const H = 20;
    const pts = buckets.map((v, i) => [(i / 11) * (W - 4) + 2, H - 2 - (v / max) * (H - 6)]);
    const line = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
    const area = `${line} L${pts[11][0].toFixed(1)} ${H - 2} L${pts[0][0].toFixed(1)} ${H - 2} Z`;
    const html = `<path class="area" d="${area}"/><path class="ln" d="${line}"/><circle class="end" cx="${pts[11][0]}" cy="${pts[11][1]}" r="2.2"/>`;
    if (svg.__html !== html) {
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('class', 'spark');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-label', 'Edits in the last hour');
      svg.innerHTML = html;
      svg.__html = html;
    }
  }

  return {
    update,
    trayFor(key) {
      return wins.get(key === HUMAN ? 'human' : key)?.tray;
    },
    focusAnswer(agentId) {
      const w = wins.get(agentId);
      w?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      w?.ask.querySelector('input')?.focus();
    },
  };
}

// The last few things an agent did, newest first, with repeats folded together.
export function feedLines(st, events, now, n) {
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < n; i--) {
    const e = events[i];
    if (e.ts > now) continue;
    const line = feedLine(st, e);
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev && prev.k === line.k && prev.text === line.text) continue;
    out.push(line);
  }
  return out;
}

function feedLine(st, e) {
  const name = (id) => blockMeta(st, id)?.name || id;
  switch (e.type) {
    case 'block.reserve':
      return { ts: e.ts, k: 'reserve', icon: e.mode === 'watch' ? 'eye' : 'reserve', text: `${e.mode === 'watch' ? 'Watching' : 'Took'} ${name(e.block)}${typeof e.agent === 'string' && e.agent !== e.by ? ` from ${agentName(st, e.by)}` : ''}` };
    case 'block.release':
      return { ts: e.ts, k: 'release', icon: 'release', text: `${e.outcome === 'landed' ? 'Landed' : 'Released'} ${name(e.block)}` };
    case 'touch':
      if (e.op === 'run') return { ts: e.ts, k: 'run', icon: 'run', text: e.cmd || 'Ran a command' };
      return { ts: e.ts, k: 'edit', icon: e.op === 'read' ? 'file' : 'edit', text: (e.files || []).map((f) => f.split('/').pop()).join(', ') };
    case 'test':
      return { ts: e.ts, k: e.ok ? 'test-ok' : 'test-fail', icon: e.ok ? 'check' : 'cross', text: e.summary || (e.ok ? 'Tests pass' : 'Tests fail') };
    case 'item.add':
      return { ts: e.ts, k: e.item.kind === 'question' ? 'ask' : e.item.kind === 'bug' ? 'bug' : 'task', icon: e.item.kind === 'question' ? 'question' : e.item.kind === 'bug' ? 'bug' : 'task', text: e.item.title };
    case 'item.update':
      if (e.answer) return { ts: e.ts, k: 'ask', icon: 'question', text: e.answer };
      return e.status === 'done' ? { ts: e.ts, k: 'task', icon: 'done', text: st.items[e.item]?.title || e.item } : null;
    case 'note':
      return { ts: e.ts, k: 'note', icon: 'note', text: e.text };
    case 'msg':
      return e.auto ? null : { ts: e.ts, k: 'note', icon: 'mail', text: e.text };
    case 'agent.join':
      return { ts: e.ts, k: 'join', icon: 'join', text: 'Joined' };
    case 'agent.leave':
      return { ts: e.ts, k: 'join', icon: 'join', text: 'Left' };
    default:
      return null;
  }
}
