// The side column, most urgent first: what needs the person (the inbox), the person's own window (their queue
// and the blocks they keep), then a window per agent. Windows are drop targets; their trays are where tiles go.

import { HUMAN, presence, presenceSince, openQuestions, blockMeta, agentName, clock } from '../core/model.js';
import { h, icon, setHtml, setText, toggle, esc, timer, initials } from './dom.js';
import { colorOf, inkOf } from './map.js';

const RANK = { question: 0, permission: 0, review: 1, working: 2, quiet: 2, blocked: 3, stale: 4, idle: 5, done: 6, gone: 7 };
const WORD = { working: 'Working', question: 'Question', permission: 'Permission', review: 'Review', blocked: 'Blocked', quiet: 'Quiet', stale: 'Gone quiet', idle: 'Idle', done: 'Done', gone: 'Left' };
const QUIET_MS = 5 * 60_000;
const MIN = 60_000;
const ROSTER_AT = 5;

// What an agent's state is, in the words the person acts on: a question to answer, a permission to grant
// (in its terminal), a finished turn to review; else working, quiet, gone quiet or idle.
export function agentState(st, a, now) {
  let p = presence(st, a.id, now);
  let since = presenceSince(st, a.id, now);
  if (p === 'waiting') p = openQuestions(st, a.id).length ? 'question' : 'permission';
  if (p === 'working' && now - a.lastSeen > QUIET_MS) {
    p = 'quiet';
    since = a.lastSeen;
  }
  return { p, since };
}

export function createSide(ctx, root) {
  const wins = new Map();
  const inbox = h('section', { class: 'win inbox', hidden: true, 'data-win': 'inbox' });
  const you = youWindow();
  const mergeHost = h('div', { class: 'merge-host', hidden: true });
  const agentsHost = h('div', { class: 'agents' });
  const empty = h('div', { class: 'side-empty' });
  root.append(inbox, you.el, mergeHost, agentsHost, empty);

  inbox.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target.closest('form[data-answer]');
    const field = form?.querySelector('input');
    if (field?.value.trim()) ctx.act.answer(form.dataset.answer, field.value.trim());
  });
  inbox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const { act, arg } = b.dataset;
    if (act === 'go') ctx.focusAgent(arg);
    else if (act === 'merge') ctx.act.copyMerge(arg);
    else if (act === 'fix') ctx.act.askFix(arg);
    else if (act === 'rebase') ctx.act.askRebase(arg);
  });

  function youWindow() {
    const name = h('div', { class: 'win-name' });
    const disc = h('span', { class: 'disc' });
    const queueTray = h('div', { class: 'tray', 'data-drop': 'queue', 'data-label': 'Next' });
    const heldTray = h('div', { class: 'tray', 'data-drop': `agent:${HUMAN}`, 'data-label': 'Yours' });
    const el = h('section', { class: 'win you', 'data-drop': 'queue', 'data-win': 'human' }, h('div', { class: 'win-head' }, disc, name), h('div', { class: 'win-body' }, queueTray, heldTray));
    el.style.setProperty('--ac', 'var(--human)');
    el.style.setProperty('--aci', 'var(--slot-gray-ink)');
    return { el, name, disc, queueTray, heldTray };
  }

  function agentWindow(id) {
    if (wins.has(id)) return wins.get(id);
    const name = h('div', { class: 'win-name' });
    const disc = h('span', { class: 'disc' });
    const lines = h('span', { class: 'win-lines', title: 'Lines changed' });
    const state = h('span', { class: 'state' });
    const more = h('button', { class: 'win-more', type: 'button', 'aria-expanded': 'false', 'aria-label': 'More', html: icon('chev') });
    const task = h('div', { class: 'win-task' });
    const doing = h('div', { class: 'win-doing' });
    const tray = h('div', { class: 'tray', 'data-drop': `agent:${id}` });
    const feed = h('ul', { class: 'feed' });
    const input = h('input', { class: 'field', id: `msg-${id}`, autocomplete: 'off', 'aria-label': 'Message' });
    const unread = h('span', { class: 'unread', hidden: true });
    const form = h('form', { class: 'msg' }, input, unread, h('button', { class: 'icon-btn', type: 'submit', 'aria-label': 'Send', title: 'Send', html: icon('send') }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      ctx.act.message(id, text).then((ok) => {
        if (ok) input.value = '';
      });
    });
    // The log and the message box sit behind the chevron, so every agent fits on screen.
    const details = h('div', { class: 'win-details', hidden: true }, feed, form);
    const el = h('section', { class: 'win', 'data-drop': `agent:${id}`, 'data-win': id }, h('div', { class: 'win-head' }, disc, name, lines, state, more), h('div', { class: 'win-body' }, task, doing, tray, details));
    const w = { el, name, disc, lines, state, more, task, doing, tray, details, feed, input, unread, open: false };
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
    const human = st.agents[HUMAN];
    setText(you.name, human.name);
    setText(you.disc, initials(human.name));
    toggle(you.el, 'has-queue', Object.values(st.blocks).some((b) => b.queued && !b.holder));
    toggle(you.el, 'has-held', human.held.length > 0);

    const agents = Object.values(st.agents)
      // Left a while ago, or silent for hours holding nothing (a crashed session never says goodbye): off the column.
      .filter((a) => a.id !== HUMAN && (a.held.length || (!a.leftAt ? now - a.lastSeen < 6 * 60 * MIN : now - a.leftAt < 10 * MIN)))
      .map((a) => ({ a, ...agentState(st, a, now) }))
      .sort((x, y) => RANK[x.p] - RANK[y.p] || x.a.joinedAt - y.a.joinedAt);

    paintInbox(st, now, agents);
    toggle(root, 'roster', agents.length >= ROSTER_AT);
    const keep = new Set();
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

  // One row per thing the person can act on, with the act beside it.
  function paintInbox(st, now, agents) {
    const rows = [];
    for (const { a, p, since } of agents) {
      const who = `<span class="disc" style="--ac:${colorOf(st, a.id)};--aci:${inkOf(st, a.id)}">${esc(initials(a.name))}</span><span class="ib-who">${esc(a.name)}</span>`;
      const t = timer(since, { warn: 5 * MIN, over: 15 * MIN }, now);
      if (p === 'question') {
        const q = openQuestions(st, a.id)[0];
        rows.push({ key: `q:${q.id}`, html: `<div class="ib-row">${who}<span class="ib-what">${esc(q.title)}</span>${t}</div><form class="ib-form" data-answer="${esc(q.id)}"><input class="field" id="answer-${esc(q.id)}" autocomplete="off" aria-label="Answer"${ctx.replayTs ? ' disabled' : ''}><button class="btn sm confirm" type="submit"${ctx.replayTs ? ' disabled' : ''}>Answer</button></form>` });
      } else if (p === 'permission') {
        rows.push({ key: `p:${a.id}`, html: `<div class="ib-row">${who}<span class="ib-what">${esc(a.doing || 'Waiting for permission')}</span>${t}<button class="btn sm" type="button" data-act="go" data-arg="${esc(a.id)}">Go</button></div>` });
      } else if (p === 'review') {
        rows.push({ key: `r:${a.id}`, html: `<div class="ib-row">${who}<span class="ib-what">${esc(a.task || 'Finished its turn')}</span>${t}<button class="btn sm" type="button" data-act="go" data-arg="${esc(a.id)}">Go</button></div>` });
      }
    }
    const head = ctx.mergeRows?.find((r) => r.entry.status === 'ready');
    if (head) {
      const t = timer(head.entry.readyAt, {}, now);
      const name = `<span class="ib-who">${esc(head.label)}</span>`;
      if (head.level === 'ok') rows.push({ key: `m:${head.entry.worktree}`, html: `<div class="ib-row"><span class="disc plain">${icon('branch')}</span>${name}<span class="ib-what">Ready to merge into ${esc(ctx.worktrees?.base || 'the base')}</span>${t}<button class="btn sm confirm" type="button" data-act="merge" data-arg="${esc(head.entry.worktree)}">Merge</button></div>` });
      else if (head.level === 'danger') rows.push({ key: `f:${head.entry.worktree}`, html: `<div class="ib-row"><span class="disc plain danger">${icon('branch')}</span>${name}<span class="ib-what">${esc(head.verdict)}</span>${t}<button class="btn sm" type="button" data-act="fix" data-arg="${esc(head.entry.worktree)}">Ask to fix</button></div>` });
      else if (head.checks[0]?.action === 'rebase') rows.push({ key: `b:${head.entry.worktree}`, html: `<div class="ib-row"><span class="disc plain">${icon('branch')}</span>${name}<span class="ib-what">${esc(head.verdict)}</span>${t}<button class="btn sm" type="button" data-act="rebase" data-arg="${esc(head.entry.worktree)}">Rebase</button></div>` });
    }
    ctx.inboxCount = rows.length;
    inbox.hidden = !rows.length;
    if (!rows.length) return;
    // Rows are kept by key, so an answer being typed survives the next render.
    const html = `<div class="win-head"><span class="disc plain">${icon('inbox')}</span><div class="win-name">Needs you</div><span class="win-count">${rows.length}</span></div><div class="ib-list">${rows.map((r) => `<div class="ib" data-key="${esc(r.key)}">${r.html}</div>`).join('')}</div>`;
    // While the person types in it, the same rows aren't redrawn (their timers tick on their own).
    const typing = inbox.contains(document.activeElement) ? document.activeElement : null;
    const keys = rows.map((r) => r.key).join('|');
    if (typing && inbox.__keys === keys) return;
    const drafts = {};
    for (const f of inbox.querySelectorAll('input')) drafts[f.id] = f.value;
    setHtml(inbox, html);
    for (const f of inbox.querySelectorAll('input')) if (drafts[f.id]) f.value = drafts[f.id];
    inbox.__keys = keys;
    if (typing?.id) document.getElementById(typing.id)?.focus();
  }

  function paintAgent(st, now, w, { a, p, since }) {
    w.el.style.setProperty('--ac', colorOf(st, a.id));
    w.el.style.setProperty('--aci', inkOf(st, a.id));
    toggle(w.el, 'gone', p === 'gone');
    toggle(w.el, 'needs', p === 'question' || p === 'permission' || p === 'review');
    setText(w.disc, initials(a.name));
    setText(w.name, a.name);
    w.name.title = [a.kind, a.model, a.where, a.id].filter(Boolean).join('\n');
    // One count of lines: the worktree's, against the base, when git knows it; else what the edits reported.
    const wt = ctx.worktrees?.list.find((x) => x.agent === a.id);
    const add = wt ? wt.add : a.added;
    const del = wt ? wt.del : a.removed;
    setText(w.lines, add || del ? `+${add} −${del}` : '');
    w.state.className = `state ${p}`;
    const t =
      p === 'working' ? timer(since, { watch: true }, now)
      : p === 'question' || p === 'permission' || p === 'review' ? timer(since, { warn: 5 * MIN, over: 15 * MIN }, now)
      : p === 'quiet' ? timer(since, { warn: 10 * MIN }, now)
      : p === 'stale' ? timer(since, { over: 2 * 60 * MIN }, now)
      : timer(since, {}, now);
    setHtml(w.state, p === 'working' ? t : `${WORD[p] || p} ${t}`);
    w.state.title = WORD[p] || p;

    setText(w.task, a.task);
    w.task.title = a.task;
    w.task.hidden = !a.task;
    const doing = a.doing || (a.lastRun && now - a.lastRun.ts < 10 * MIN ? a.lastRun.cmd : '');
    const shown = doing.replace(/\S*\/(\S+)/g, '$1');
    const same = !!a.task && shown.includes(a.task);
    setText(w.doing, same ? '' : shown);
    w.doing.title = doing;
    w.doing.hidden = !doing || same || p === 'gone';

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
    mergeHost,
    trayFor(key) {
      if (key === 'queue') return you.queueTray;
      if (key === HUMAN) return you.heldTray;
      return wins.get(key)?.tray;
    },
    focusAnswer() {
      inbox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      inbox.querySelector('input')?.focus();
    },
    windowOf(id) {
      return wins.get(id)?.el;
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
    case 'merge.ready':
      return { ts: e.ts, k: 'release', icon: 'branch', text: 'Ready to merge' };
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
