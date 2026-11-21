// The side column: a window per agent (its tray holds the blocks it reserved), the human's own
// window, and the Up next queue. Windows are drop targets; their trays are where tiles go.

import { HUMAN, presence, presenceSince, openQuestions, blockMeta, agentName, clock } from '../core/model.js';
import { h, icon, setHtml, setText, toggle, esc, timer, initials } from './dom.js';
import { colorOf, inkOf } from './map.js';

const RANK = { waiting: 0, review: 1, working: 2, quiet: 2, blocked: 3, stale: 4, idle: 5, done: 6, gone: 7 };
const WORD = { working: 'Working', waiting: 'Needs you', review: 'Your turn', blocked: 'Blocked', quiet: 'Quiet', stale: 'Gone quiet', idle: 'Idle', done: 'Done', gone: 'Left' };
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
    const disc = h('span', { class: key === 'queue' ? 'disc plain' : 'disc', html: key === 'queue' ? icon('queue') : '' });
    const el = h('section', { class: 'win compact', 'data-drop': drop, 'data-win': key }, h('div', { class: 'win-head' }, disc, name, count), tray);
    row.append(el);
    const w = { el, tray, name, count, disc };
    wins.set(key, w);
    return w;
  }

  function agentWindow(id) {
    if (wins.has(id)) return wins.get(id);
    const name = h('div', { class: 'win-name' });
    const disc = h('span', { class: 'disc' });
    const lines = h('span', { class: 'win-lines', title: 'Lines added and removed' });
    const state = h('span', { class: 'state' });
    const more = h('button', { class: 'win-more', type: 'button', 'aria-expanded': 'false', 'aria-label': 'More', html: icon('chev') });
    const task = h('div', { class: 'win-task' });
    const doing = h('div', { class: 'win-doing' });
    const ask = h('div', { class: 'ask', hidden: true });
    const tray = h('div', { class: 'tray', 'data-drop': `agent:${id}` });
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
    // The log and the message box sit behind the header's chevron, so every agent fits on screen.
    const details = h('div', { class: 'win-details', hidden: true }, feed, form);
    const el = h(
      'section',
      { class: 'win', 'data-drop': `agent:${id}`, 'data-win': id },
      h('div', { class: 'win-head' }, disc, name, lines, state, more),
      h('div', { class: 'win-body' }, task, doing, ask, tray, details),
    );
    const w = { el, name, disc, lines, state, more, task, doing, ask, tray, details, feed, input, unread, askId: null, open: false };
    more.addEventListener('click', () => {
      w.open = !w.open;
      details.hidden = !w.open;
      more.setAttribute('aria-expanded', String(w.open));
      el.classList.toggle('open', w.open);
      update();
    });
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
    setText(hu.disc, initials(st.agents[HUMAN].name));
    hu.el.style.setProperty('--ac', 'var(--human)');
    hu.el.style.setProperty('--aci', 'var(--slot-gray-ink)');

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
    w.el.style.setProperty('--aci', inkOf(st, a.id));
    toggle(w.el, 'gone', p === 'gone');
    toggle(w.el, 'needs', p === 'waiting' || p === 'review');
    setText(w.disc, initials(a.name));
    setText(w.name, a.name);
    setText(w.lines, a.added || a.removed ? `+${a.added} −${a.removed}` : '');
    w.name.title = [a.kind === 'claude-code' ? 'Claude Code' : a.kind, a.model, a.where, a.id].filter(Boolean).join('\n');
    w.state.className = `state ${p}`;
    const t =
      p === 'working' ? timer(since, { watch: true }, now)
      : p === 'waiting' || p === 'review' ? timer(since, { warn: 5 * MIN, over: 15 * MIN }, now)
      : p === 'quiet' ? timer(since, { warn: 10 * MIN }, now)
      : p === 'stale' ? timer(since, { over: 2 * 60 * MIN }, now)
      : timer(since, {}, now);
    setHtml(w.state, p === 'working' ? t : `${WORD[p] || p} ${t}`);
    w.state.title = WORD[p] || p;

    setText(w.task, a.task);
    w.task.title = a.task;
    w.task.hidden = !a.task;
    const doing = a.doing || (a.lastRun && now - a.lastRun.ts < 10 * MIN ? a.lastRun.cmd : '');
    setText(w.doing, doing.replace(/\S*\/(\S+)/g, '$1'));
    w.doing.title = doing;
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
      for (const el of w.ask.querySelectorAll('input,button')) el.disabled = !!ctx.replayTs;
      w.ask.hidden = false;
    } else {
      w.ask.hidden = true;
      w.askId = null;
    }

    if (w.open) {
      const lines = feedLines(st, ctx.eventsOf(a.id), now, 5);
      setHtml(w.feed, lines.map((l) => `<li class="k-${l.k}"><time>${clock(l.ts)}</time>${icon(l.icon)}<span class="t" title="${esc(l.text)}">${esc(l.text)}</span></li>`).join(''));
    }
    w.unread.hidden = !a.inbox.length;
    setText(w.unread, a.inbox.length ? `${a.inbox.length} unread` : '');
    w.input.placeholder = `Message ${a.name}`;
    w.input.disabled = !!a.leftAt || !!ctx.replayTs;
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
