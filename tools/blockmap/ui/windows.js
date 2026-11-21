// The side column: a window per agent (its tray holds the blocks it reserved), the human's own
// window, and the Up next queue. Windows are drop targets; their trays are where tiles go.

import { HUMAN, presence, openQuestions, blockMeta, agentName, ago, clock } from '../core/model.js';
import { h, icon, setHtml, setText, toggle, initials, esc } from './dom.js';

const RANK = { waiting: 0, working: 1, blocked: 2, stale: 3, idle: 4, done: 5, gone: 6 };
const STATUS_WORD = { working: 'Working', waiting: 'Needs you', blocked: 'Blocked', stale: 'Gone quiet', idle: 'Idle', done: 'Done', gone: 'Left' };

export function createSide(ctx, root) {
  const wins = new Map();
  const row = h('div', { class: 'side-row' });
  const agentsHost = h('div', { style: { display: 'contents' } });
  const empty = h('div', { class: 'side-empty' });
  root.append(row, agentsHost, empty);

  function fixedWindow(key) {
    if (wins.has(key)) return wins.get(key);
    const isQueue = key === 'queue';
    const tray = h('div', { class: 'tray', 'data-drop': isQueue ? 'queue' : `agent:${HUMAN}` });
    const name = h('div', { class: 'win-name' });
    const sub = h('div', { class: 'win-sub' });
    const avatar = h('div', { class: isQueue ? 'avatar square' : 'avatar human', html: isQueue ? icon('queue') : '' });
    const el = h(
      'section',
      { class: 'win compact', 'data-drop': isQueue ? 'queue' : `agent:${HUMAN}`, 'data-win': key },
      h('div', { class: 'win-head' }, avatar, h('div', { class: 'win-title' }, name, sub), h('span')),
      tray,
    );
    row.append(el);
    const w = { el, tray, name, sub, avatar, fixed: true };
    wins.set(key, w);
    return w;
  }

  function agentWindow(id) {
    if (wins.has(id)) return wins.get(id);
    const avatar = h('div', { class: 'avatar' });
    const name = h('div', { class: 'win-name' });
    const sub = h('div', { class: 'win-sub' });
    const pill = h('span', { class: 'pill' });
    const task = h('div', { class: 'win-task' });
    const doing = h('div', { class: 'win-doing' });
    const ask = h('div', { class: 'ask-card', hidden: true });
    const tray = h('div', { class: 'tray', 'data-drop': `agent:${id}`, 'data-empty': 'Drop a block here to give it to this agent.' });
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const nums = h('div', { class: 'win-nums' });
    const feed = h('ul', { class: 'feed' });
    const inbox = h('div', { class: 'inbox-note', hidden: true });
    const input = h('input', { class: 'field', id: `msg-${id}`, placeholder: 'Message this agent…', autocomplete: 'off', 'aria-label': 'Message' });
    const form = h('form', { class: 'msg' }, input, h('button', { class: 'btn', type: 'submit', html: `${icon('send')}Send` }));
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
      h('div', { class: 'win-head' }, avatar, h('div', { class: 'win-title' }, name, sub), pill),
      task,
      doing,
      ask,
      tray,
      h('div', { class: 'win-foot' }, spark, nums),
      feed,
      inbox,
      form,
    );
    const w = { el, avatar, name, sub, pill, task, doing, ask, tray, spark, nums, feed, inbox, input, askId: null };
    wins.set(id, w);
    return w;
  }

  function update() {
    const st = ctx.view;
    const now = ctx.viewNow;

    const q = fixedWindow('queue');
    setText(q.name, 'Up next');
    setText(q.sub, 'Agents take these first');
    q.tray.dataset.empty = 'Drop blocks here to queue them.';
    q.el.style.setProperty('--ac', 'var(--ink-2)');

    const hu = fixedWindow('human');
    const human = st.agents[HUMAN];
    setText(hu.name, human.name);
    setText(hu.sub, 'Agents stay out of these');
    hu.avatar.textContent = initials(human.name);
    hu.tray.dataset.empty = 'Drop a block here to keep it for yourself.';
    hu.el.style.setProperty('--ac', 'var(--human)');

    const agents = Object.values(st.agents)
      .filter((a) => a.id !== HUMAN && (!a.leftAt || a.held.length || now - a.leftAt < 10 * 60_000))
      .map((a) => ({ a, p: presence(st, a.id, now) }))
      .sort((x, y) => RANK[x.p] - RANK[y.p] || x.a.joinedAt - y.a.joinedAt);

    const keep = new Set(['queue', 'human']);
    for (const { a, p } of agents) {
      keep.add(a.id);
      const w = agentWindow(a.id);
      paintAgent(st, now, w, a, p);
    }
    for (const [key, w] of wins) {
      if (keep.has(key)) continue;
      w.el.remove();
      wins.delete(key);
    }
    const order = agents.map(({ a }) => wins.get(a.id).el);
    order.forEach((el, i) => {
      if (agentsHost.children[i] !== el) agentsHost.insertBefore(el, agentsHost.children[i] || null);
    });
    empty.hidden = agents.length > 0;
    if (!agents.length) {
      setHtml(
        empty,
        ctx.mode === 'demo'
          ? 'Agents join in a moment.'
          : `No agents on the board yet. An agent joins with <code>tools/blockmap/bm join --name Heron</code>, or on its own once the Claude Code hooks are on (<code>bm hooks install</code>).`,
      );
    }
  }

  function paintAgent(st, now, w, a, p) {
    w.el.style.setProperty('--ac', a.color);
    toggle(w.el, 'gone', p === 'gone');
    w.avatar.textContent = initials(a.name);
    setText(w.name, a.name);
    setText(w.sub, [a.kind === 'claude-code' ? 'Claude Code' : a.kind, a.model, a.where].filter(Boolean).join(' · '));
    w.pill.className = `pill ${p}`;
    setText(w.pill, p === 'stale' ? `Quiet ${ago(now - a.lastSeen)}` : STATUS_WORD[p] || p);
    setText(w.task, a.task || (a.held.length ? '' : 'No task yet'));
    w.task.hidden = !a.task && !!a.held.length;
    const doing = a.doing || (a.lastRun && now - a.lastRun.ts < 10 * 60_000 ? `Ran ${a.lastRun.cmd}` : '');
    setText(w.doing, doing);
    w.doing.hidden = !doing;
    w.tray.dataset.empty = a.leftAt ? 'Left the board.' : 'Drop a block here to give it to this agent.';

    const qs = openQuestions(st, a.id);
    const qItem = qs[0];
    if (qItem) {
      if (w.askId !== qItem.id) {
        w.askId = qItem.id;
        w.ask.textContent = '';
        const field = h('input', { class: 'field', id: `answer-${a.id}`, placeholder: 'Answer…', autocomplete: 'off', 'aria-label': 'Answer' });
        const form = h('form', {}, field, h('button', { class: 'btn ask', type: 'submit' }, 'Answer'));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!field.value.trim()) return;
          ctx.act.answer(qItem.id, field.value.trim());
        });
        w.ask.append(h('div', { class: 'q', html: `${icon('hand')}<span>${esc(qItem.title)}</span>` }), form);
      }
      w.ask.hidden = false;
    } else {
      w.ask.hidden = true;
      w.askId = null;
    }

    paintSpark(w.spark, ctx.eventsOf(a.id), now);
    setHtml(w.nums, `<b>${a.edits}</b> edits · <b>${a.tests}</b> test runs<br>seen ${ago(now - a.lastSeen)} ago`);
    const lines = feedLines(st, ctx.eventsOf(a.id), now, 4);
    setHtml(w.feed, lines.map((l) => `<li class="k-${l.k}"><time>${clock(l.ts)}</time>${icon(l.icon)}<span class="t" title="${esc(l.text)}">${esc(l.text)}</span></li>`).join(''));
    const unread = a.inbox.length;
    w.inbox.hidden = !unread;
    setText(w.inbox, unread ? `${unread} message${unread > 1 ? 's' : ''} waiting for ${a.name} to read` : '');
    w.input.placeholder = `Message ${a.name}…`;
    w.input.disabled = !!a.leftAt;
  }

  function paintSpark(svg, events, now) {
    const buckets = new Array(12).fill(0);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.ts > now) continue;
      const age = now - e.ts;
      if (age > 60 * 60_000) break;
      if (e.type === 'touch' && e.op !== 'run') buckets[11 - Math.floor(age / (5 * 60_000))]++;
    }
    const max = Math.max(3, ...buckets);
    const W = 160;
    const H = 26;
    const pts = buckets.map((v, i) => [(i / 11) * (W - 4) + 2, H - 3 - (v / max) * (H - 7)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${pts[11][0].toFixed(1)} ${H - 3} L${pts[0][0].toFixed(1)} ${H - 3} Z`;
    const end = pts[11];
    const html = `<line class="base" x1="2" x2="${W - 2}" y1="${H - 2.5}" y2="${H - 2.5}"/><path class="area" d="${area}"/><path class="ln" d="${line}"/><circle class="end" cx="${end[0]}" cy="${end[1]}" r="2.4"/>`;
    if (svg.__html !== html) {
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('class', 'spark');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-label', 'Edits per five minutes, last hour');
      svg.innerHTML = html;
      svg.__html = html;
    }
  }

  return {
    update,
    trayFor(key) {
      if (key === HUMAN) return wins.get('human')?.tray;
      return wins.get(key)?.tray;
    },
    windowFor(key) {
      return wins.get(key === HUMAN ? 'human' : key)?.el;
    },
    focusAnswer(agentId) {
      const w = wins.get(agentId);
      w?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      w?.ask.querySelector('input')?.focus();
    },
  };
}

// The last few things an agent did, newest first, with runs of edits folded together.
export function feedLines(st, events, now, n) {
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < n; i--) {
    const e = events[i];
    if (e.ts > now) continue;
    const line = feedLine(st, e);
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev && prev.k === 'edit' && line.k === 'edit' && prev.text === line.text) continue;
    out.push(line);
  }
  return out;
}

function feedLine(st, e) {
  const name = (id) => blockMeta(st, id)?.name || id;
  switch (e.type) {
    case 'block.reserve':
      return { ts: e.ts, k: 'reserve', icon: e.mode === 'watch' ? 'eye' : 'reserve', text: `${e.mode === 'watch' ? 'Watching' : 'Reserved'} ${name(e.block)}${e.by !== (e.agent || e.by) ? ` (from ${agentName(st, e.by)})` : ''}` };
    case 'block.release':
      return { ts: e.ts, k: 'release', icon: 'release', text: `Released ${name(e.block)}${e.outcome ? `, ${e.outcome}` : ''}` };
    case 'touch':
      if (e.op === 'run') return { ts: e.ts, k: 'run', icon: 'run', text: e.cmd || 'Ran a command' };
      return { ts: e.ts, k: 'edit', icon: e.op === 'read' ? 'file' : 'edit', text: `${e.op === 'read' ? 'Read' : 'Edited'} ${(e.files || []).map((f) => f.split('/').pop()).join(', ')}` };
    case 'test':
      return { ts: e.ts, k: e.ok ? 'test-ok' : 'test-fail', icon: e.ok ? 'check' : 'cross', text: `Tests ${e.ok ? 'pass' : 'fail'}${e.summary ? `: ${e.summary}` : ''}` };
    case 'item.add':
      return { ts: e.ts, k: e.item.kind === 'question' ? 'ask' : e.item.kind === 'bug' ? 'bug' : 'task', icon: e.item.kind === 'question' ? 'question' : e.item.kind === 'bug' ? 'bug' : 'task', text: `${e.item.kind === 'question' ? 'Asked' : `Filed ${e.item.kind}`}: ${e.item.title}` };
    case 'item.update':
      if (e.answer) return { ts: e.ts, k: 'ask', icon: 'question', text: `Answered: ${e.answer}` };
      return e.status === 'done' ? { ts: e.ts, k: 'task', icon: 'done', text: `Finished ${st.items[e.item]?.title || e.item}` } : null;
    case 'note':
      return { ts: e.ts, k: 'note', icon: 'note', text: e.text };
    case 'msg':
      return { ts: e.ts, k: 'note', icon: 'send', text: `${agentName(st, e.by)}: ${e.text}` };
    case 'agent.join':
      return { ts: e.ts, k: 'join', icon: 'join', text: 'Joined the board' };
    case 'agent.leave':
      return { ts: e.ts, k: 'join', icon: 'join', text: 'Left the board' };
    default:
      return null;
  }
}
