// The board page: folds the log into state, renders the map, the windows, the timeline and the
// inspector from it, and turns what the person does (drag a tile, answer a question) into events.

import { HUMAN, apply, reduce, alerts, presence, needsHuman, blockMeta, agentName, clock } from '../core/model.js';
import { blockForPath } from '../core/glob.js';
import { connect } from './source.js';
import { createMap } from './map.js';
import { createSide } from './windows.js';
import { createTimeline } from './timeline.js';
import { createInspector } from './inspector.js';
import { createTethers } from './tethers.js';
import { enableDnd } from './dnd.js';
import { createWorktrees, worktreeIndex } from './worktrees.js';
import { agentForWorktree, mergeChecks, mergeCommand } from '../core/merges.js';
import { h, icon, setHtml, setText, toast, storageGet, storageSet, esc, timer, startTimers, copyText } from './dom.js';
import { PALETTE_NAMES, applyPalette } from './palette.js';

const $ = (id) => document.getElementById(id);

const ctx = {
  board: null,
  events: [],
  live: null,
  view: null,
  viewNow: Date.now(),
  replayTs: null,
  lens: storageGet('blockmap.lens', 'work'),
  search: null,
  selected: null,
  mode: 'connecting',
  source: null,
  byAgent: new Map(),
  alertsOpen: false,
  toast,
  liveNow: () => Date.now(),
  eventsOf(id) {
    return this.byAgent.get(id) || [];
  },
};

ctx.map = createMap(ctx, $('map'));
const side = createSide(ctx, $('side'));
const timeline = createTimeline(ctx, $('timeline'));
const inspector = createInspector(ctx, $('inspector'), $('scrim'));
const tethers = createTethers(ctx, $('tethers'), $('map-wrap'), $('side'));
const trees = createWorktrees(ctx, $('wt-bar'), side.mergeHost);
ctx.worktrees = null;
ctx.focusWt = null;
ctx.mergeRows = [];
ctx.activeOnly = storageGet('blockmap.activeOnly', matchMedia('(max-width: 860px)').matches);

// Focus one worktree: the map lights the blocks it changed and its agent's window comes into view.
ctx.focus = (name) => {
  ctx.focusWt = name && name !== ctx.focusWt ? name : null;
  render();
  const wt = ctx.worktrees?.list.find((w) => w.name === ctx.focusWt);
  if (wt?.agent) document.querySelector(`.win[data-win="${CSS.escape(wt.agent)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

// Go to an agent: its worktree in focus (path, cd, editor link) and its window flashed into view.
ctx.focusAgent = (id) => {
  const wt = ctx.worktrees?.list.find((w) => w.agent === id && !w.main);
  if (wt && ctx.focusWt !== wt.name) ctx.focus(wt.name);
  const win = side.windowOf(id);
  if (!win) return;
  win.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  win.classList.add('flash');
  setTimeout(() => win.classList.remove('flash'), 900);
};

enableDnd(ctx);

// ------------------------------------------------------------------------------------------- state

function index(e) {
  const keys = new Set([e.by, typeof e.agent === 'string' ? e.agent : null, e.to && e.to !== '*' ? e.to : null]);
  for (const k of keys) {
    if (!k) continue;
    if (!ctx.byAgent.has(k)) ctx.byAgent.set(k, []);
    ctx.byAgent.get(k).push(e);
  }
}

function setBoard(board, events) {
  ctx.board = board;
  ctx.events = events.slice();
  ctx.byAgent = new Map();
  for (const e of ctx.events) index(e);
  ctx.live = reduce(board, ctx.events);
  ctx.map.build(board);
  setText($('board-name'), board.name);
  document.title = `${board.name} Blockmap`;
  computeView();
  render();
}

// A replay moving forward applies only the events since its last frame; going back folds again from the start.
let replayFold = null;
function replayState(ts) {
  const evs = ctx.events;
  let f = replayFold;
  if (!f || f.board !== ctx.board || f.n !== evs.length || ts < f.ts) f = { board: ctx.board, n: evs.length, i: 0, ts: -Infinity, state: reduce(ctx.board, []) };
  while (f.i < evs.length && evs[f.i].ts <= ts) apply(f.state, evs[f.i++]);
  f.ts = ts;
  replayFold = f;
  return f.state;
}

function computeView() {
  if (ctx.replayTs) {
    ctx.view = replayState(ctx.replayTs);
    ctx.viewNow = ctx.replayTs;
  } else {
    replayFold = null;
    ctx.view = ctx.live;
    ctx.viewNow = Date.now();
  }
}

ctx.replay = (ts) => {
  ctx.replayTs = ts;
  computeView();
  render();
};

ctx.select = (id) => {
  ctx.selected = id;
  if (id) inspector.open(id);
  else inspector.close();
  render();
};
ctx.selectQuiet = (id) => {
  ctx.selected = id;
  render();
};

// ----------------------------------------------------------------------------------------- actions

async function commit(list, ok) {
  if (ctx.replayTs) {
    toast('Back to live to change the board.');
    return false;
  }
  try {
    await ctx.source.commit(list);
    if (ok) toast(ok);
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

const nameOf = (id) => blockMeta(ctx.live, id)?.name || id;
const humanName = () => ctx.live.agents[HUMAN].name;

ctx.act = {
  assign(block, agent) {
    const b = ctx.live.blocks[block];
    const list = [];
    if (b.holder && b.holder !== agent) {
      list.push({ type: 'block.release', agent: b.holder, block, outcome: 'handoff', note: `given to ${agentName(ctx.live, agent)}` });
      if (b.holder !== HUMAN) list.push({ type: 'msg', auto: true, to: b.holder, text: `Moved ${nameOf(block)} (${block}) to ${agentName(ctx.live, agent)}. Stop editing there.` });
    }
    list.push({ type: 'block.reserve', agent, block, intent: b.intent || b.queued?.note || '' });
    if (agent !== HUMAN) list.push({ type: 'msg', auto: true, to: agent, text: `Assigned to you: ${nameOf(block)} (${block}). \`bm show ${block}\` lists its docs and open items.` });
    return commit(list, agent === HUMAN ? `You hold ${nameOf(block)}. Agents stay out.` : `Gave ${nameOf(block)} to ${agentName(ctx.live, agent)}.`);
  },
  release(block) {
    const b = ctx.live.blocks[block];
    if (!b.holder) return Promise.resolve(false);
    const list = [{ type: 'block.release', agent: b.holder, block, outcome: 'parked', note: `released by ${humanName()}` }];
    if (b.holder !== HUMAN) list.push({ type: 'msg', auto: true, to: b.holder, text: `Took ${nameOf(block)} (${block}) back. Stop editing there.` });
    return commit(list, `${nameOf(block)} is free.`);
  },
  queue(block) {
    const b = ctx.live.blocks[block];
    const list = [];
    if (b.holder) {
      list.push({ type: 'block.release', agent: b.holder, block, outcome: 'parked', note: 'moved to the queue' });
      if (b.holder !== HUMAN) list.push({ type: 'msg', auto: true, to: b.holder, text: `Moved ${nameOf(block)} (${block}) back to the queue. Stop editing there.` });
    }
    list.push({ type: 'block.queue', block, note: b.intent || '' });
    return commit(list, `${nameOf(block)} is up next.`);
  },
  unqueue: (block) => commit([{ type: 'block.unqueue', block }], `${nameOf(block)} is off the queue.`),
  freeze: (block, on) => commit([{ type: 'block.freeze', block, on }], on ? `Froze ${nameOf(block)}.` : `Unfroze ${nameOf(block)}.`),
  addItem: (item) => commit([{ type: 'item.add', item }], `Filed it in ${nameOf(item.block)}.`),
  updateItem: (id, patch) => commit([{ type: 'item.update', item: id, ...patch }]),
  answer: (id, text) => commit([{ type: 'item.update', item: id, answer: text, status: 'done' }], 'Answered. It lands in the agent’s inbox.'),
  message: (agent, text) => commit([{ type: 'msg', to: agent, text }], `Sent to ${agentName(ctx.live, agent)}.`),
  mergeReady(wt) {
    if (!wt.ahead) {
      toast(wt.dirty ? 'Nothing committed yet. Commit, then queue it.' : `Nothing to merge: no commits ahead of ${ctx.worktrees?.base || 'the base'}.`);
      return Promise.resolve(false);
    }
    return commit([{ type: 'merge.ready', worktree: wt.name, branch: wt.branch, commit: wt.head, ahead: wt.ahead, ...(wt.agent ? { agent: wt.agent } : {}) }], `${labelOfTree(wt.name)} is in the merge queue.`);
  },
  mergeUnready: (name) => commit([{ type: 'merge.unready', worktree: name }], `${labelOfTree(name)} is out of the merge queue.`),
  // Move a queued branch to a place in the queue (0 is the head): its position goes halfway between its new neighbors.
  mergeMove(name, to) {
    const ready = Object.values(ctx.live.merges).filter((m) => m.status === 'ready' && m.worktree !== name).sort((a, b) => a.pos - b.pos);
    if (!ctx.live.merges[name] || to < 0 || to > ready.length) return Promise.resolve(false);
    const before = ready[to - 1]?.pos;
    const after = ready[to]?.pos;
    const pos = before === undefined ? (after ?? 0) - 1 : after === undefined ? before + 1 : (before + after) / 2;
    return commit([{ type: 'merge.order', worktree: name, pos }]);
  },
  copyMerge(name) {
    const entry = ctx.live.merges[name];
    if (entry) copyText(mergeCommand(entry, ctx.worktrees?.base), 'Copied the merge command.');
  },
  askFix(name) {
    const row = ctx.mergeRows.find((r) => r.entry.worktree === name);
    const bad = row?.checks.filter((c) => c.level === 'danger') || [];
    const text = `Your branch can't merge yet: ${bad.map((c) => `${c.text}${c.files ? ` (${c.files.slice(0, 6).join(', ')})` : ''}${c.detail ? ` (${c.detail})` : ''}`).join('; ') || 'it has problems'}. Fix it, commit, and \`bm ready\` again.`;
    return askTree(name, text, 'Asked for a fix.');
  },
  askRebase(name) {
    const base = ctx.worktrees?.base || 'the base';
    return askTree(name, `Your branch is behind ${base}. Rebase onto ${base} (\`git rebase ${base}\`), run the tests, then \`bm ready\` again.`, 'Asked for a rebase.');
  },
};

function labelOfTree(name) {
  const wt = ctx.worktrees?.list.find((w) => w.name === name);
  return wt?.agent ? agentName(ctx.live, wt.agent) : name;
}

// A note for the agent in a worktree; when nobody there talks to the board, the command to run yourself.
function askTree(name, text, done) {
  const wt = ctx.worktrees?.list.find((w) => w.name === name);
  const agent = wt?.agent && !wt.agent.startsWith('wt-') ? wt.agent : null;
  if (agent) return commit([{ type: 'msg', to: agent, text }], `${done} ${agentName(ctx.live, agent)} gets it on its next step.`);
  copyText(wt ? `cd "${wt.path}"` : name, `No agent on the board works in ${name}. Copied its cd command.`);
  return Promise.resolve(false);
}

// ------------------------------------------------------------------------------------------ render

let raf = 0;
ctx.render = () => render();
function render() {
  if (!raf) raf = requestAnimationFrame(doRender);
}

function doRender() {
  raf = 0;
  document.documentElement.style.setProperty('--top-h', `${Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom)}px`);
  if (!ctx.view) return;
  if (!ctx.replayTs) {
    ctx.view = ctx.live;
    ctx.viewNow = Date.now();
  }
  const before = new Map();
  for (const [id, tile] of ctx.map.tiles) before.set(id, tile.getBoundingClientRect());
  ctx.alertList = alerts(ctx.view, ctx.viewNow);
  if (ctx.worktrees) for (const wt of ctx.worktrees.list) wt.agent = agentForWorktree(ctx.view, wt);
  ctx.wtIndex = worktreeIndex(ctx.view, ctx.worktrees);
  ctx.mergeRows = ctx.worktrees ? mergeChecks(ctx.view, ctx.worktrees, ctx.viewNow) : [];
  document.body.dataset.lens = ctx.lens;
  document.body.classList.toggle('inspecting', !!inspector.id);
  document.body.classList.toggle('replaying', !!ctx.replayTs);
  side.update();
  trees.update();
  const moved = placeTiles();
  ctx.map.paint();
  // After the paint, which decides which slots the Active view hides.
  ctx.map.fit();
  paintTop();
  paintAlerts();
  paintAttention();
  timeline.update();
  inspector.update();
  fly(moved, before);
  tethers.draw();
}

// Put every tile where its block is: its map slot, its holder's tray, or the queue.
function placeTiles() {
  const st = ctx.view;
  const trays = new Map();
  const moves = [];
  for (const [id, tile] of ctx.map.tiles) {
    const b = st.blocks[id];
    const slot = ctx.map.slots.get(id);
    let into = slot;
    if (b?.holder) into = side.trayFor(b.holder) || slot;
    else if (b?.queued) into = side.trayFor('queue') || slot;
    if (into === slot) {
      if (tile.parentElement !== slot) moves.push([tile, slot]);
    } else {
      if (!trays.has(into)) trays.set(into, []);
      trays.get(into).push(id);
    }
  }
  for (const [tray, ids] of trays) {
    ids.sort((a, b) => {
      const x = st.blocks[a];
      const y = st.blocks[b];
      return x.holder ? x.since - y.since : x.queued.pos - y.queued.pos;
    });
    const current = [...tray.children].filter((c) => c.classList.contains('tile'));
    const same = current.length === ids.length && current.every((c, i) => c.dataset.block === ids[i]);
    if (same) continue;
    for (const id of ids) moves.push([ctx.map.tiles.get(id), tray]);
  }
  for (const [tile, into] of moves) into.append(tile);
  for (const [tray] of trays) for (const c of [...tray.children]) if (c.classList.contains('tile') && !trays.get(tray).includes(c.dataset.block)) ctx.map.slots.get(c.dataset.block)?.append(c);
  return moves.map(([tile]) => tile);
}

// FLIP: each moved tile starts where it was and glides to where it is now.
function fly(tiles, before) {
  // A replay moves many tiles a frame; they jump, so the motion means a live change.
  if (!tiles.length || ctx.replayTs || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const tile of tiles) {
    const a = before.get(tile.dataset.block);
    const b = tile.getBoundingClientRect();
    if (!a || !a.width || !b.width) continue;
    // Inside the zoomed map a translation is scaled by the zoom, so undo it.
    const z = tile.closest('.map') ? ctx.map.zoom : 1;
    const dx = (a.left - b.left) / z;
    const dy = (a.top - b.top) / z;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    tile.style.zIndex = '20';
    const anim = tile.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${a.width / b.width}, ${a.height / b.height})`, transformOrigin: '0 0' },
        { transform: 'none', transformOrigin: '0 0' },
      ],
      { duration: 560, easing: 'cubic-bezier(.2,.75,.15,1)' },
    );
    anim.onfinish = anim.oncancel = () => {
      tile.style.zIndex = '';
    };
  }
  tethers.follow(620);
}

function paintTop() {
  const st = ctx.view;
  const now = ctx.viewNow;
  const agents = Object.values(st.agents).filter((a) => a.id !== HUMAN && !a.leftAt);
  const working = agents.filter((a) => presence(st, a.id, now) === 'working').length;
  const held = Object.values(st.blocks).filter((b) => b.holder).length;
  let bugs = 0;
  for (const it of Object.values(st.items)) if (it.kind === 'bug' && it.status !== 'done' && it.status !== 'wontfix') bugs++;
  // Needs-you is the inbox's count, and takes you there; bugs filters the map to the blocks that have them.
  const need = ctx.inboxCount || 0;
  const stat = (n, word, extra = '') => `<b>${n}</b>${word}${extra}`;
  setHtml(
    $('stats'),
    [
      `<button type="button" class="stat${need ? '' : ' zero'}" data-go="inbox"${need ? '' : ' disabled'}>${need ? '<i class="dot-warn"></i>' : ''}${stat(need, 'need you')}</button>`,
      `<span class="stat${working ? '' : ' zero'}">${stat(working, 'working')}</span>`,
      `<span class="stat${held ? '' : ' zero'}">${stat(held, 'held')}</span>`,
      `<button type="button" class="stat${bugs ? '' : ' zero'}" data-filter="bugs" aria-pressed="${ctx.filter === 'bugs'}">${stat(bugs, bugs === 1 ? 'bug' : 'bugs')}</button>`,
    ].join(''),
  );
  const conn = $('conn');
  const mode = ctx.replayTs ? 'replay' : ctx.connState || ctx.mode;
  conn.className = `conn ${mode}`;
  conn.hidden = mode === 'live';
  setText(conn.lastElementChild, mode === 'replay' ? `Replay ${clock(ctx.replayTs)}` : { demo: 'Demo', offline: 'Reconnecting', connecting: 'Connecting' }[mode] || mode);
}

// One strip: each alert a chip that opens what it's about. Questions live in the inbox, so they aren't repeated here.
function paintAlerts() {
  const al = ctx.alertList.filter((a) => a.kind !== 'question');
  const now = ctx.viewNow;
  const strip = $('alerts');
  const room = matchMedia('(max-width: 860px)').matches ? 2 : 3;
  const shown = ctx.alertsOpen ? al : al.slice(0, room);
  const away = ctx.away && !ctx.replayTs ? awayLine(ctx.away.since) : '';
  const rows = shown.map((a) => {
    const kind = a.severity === 'high' ? 'high' : 'warn';
    return `<div class="alert ${kind}" role="button" tabindex="0" data-alert-block="${esc(a.block || '')}" data-alert-agent="${esc(a.agent || '')}" data-alert-kind="${esc(a.kind)}"><i class="${kind === 'high' ? 'dot-danger' : 'dot-warn'}"></i><span class="txt" title="${esc(a.text)}">${esc(a.text)}</span>${timer(a.ts, {}, now)}</div>`;
  });
  if (al.length > room) rows.push(`<button class="more" type="button" data-alert-more>${ctx.alertsOpen ? 'Fewer' : `+${al.length - room}`}</button>`);
  if (away) rows.unshift(`<div class="alert away"><i class="dot-muted"></i><span class="txt" title="${esc(away)}">${esc(away)}</span><button class="btn" type="button" data-away-replay>Replay</button><button class="icon-btn" type="button" data-away-close aria-label="Dismiss">${icon('close')}</button></div>`);
  strip.classList.toggle('open', !!ctx.alertsOpen);
  setHtml(strip, rows.join(''));
}

// What happened while the page was in the background, in one sentence.
function awayLine(since) {
  const evs = ctx.events.filter((e) => e.ts >= since);
  const n = (f) => evs.filter(f).length;
  const landed = n((e) => e.type === 'block.release' && e.outcome === 'landed');
  const bugs = n((e) => e.type === 'item.add' && e.item?.kind === 'bug');
  const asked = n((e) => e.type === 'item.add' && e.item?.kind === 'question');
  const failed = n((e) => e.type === 'test' && !e.ok);
  let add = 0;
  let del = 0;
  for (const e of evs) if (e.type === 'touch') {
    add += e.add || 0;
    del += e.del || 0;
  }
  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    landed && plural(landed, 'block landed', 'blocks landed'),
    (add || del) && `+${add} −${del} lines`,
    bugs && plural(bugs, 'bug filed', 'bugs filed'),
    asked && plural(asked, 'question', 'questions'),
    failed && plural(failed, 'failing test run', 'failing test runs'),
  ].filter(Boolean);
  return `Since ${clock(since)}: ${parts.length ? parts.join(', ') : 'nothing new'}.`;
}

ctx.showAway = (since) => {
  ctx.away = { since };
  render();
};

$('stats').addEventListener('click', (e) => {
  if (e.target.closest('[data-go="inbox"]')) return side.focusAnswer();
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  ctx.filter = ctx.filter === b.dataset.filter ? null : b.dataset.filter;
  render();
});

$('alerts').addEventListener('click', (e) => {
  if (e.target.closest('[data-away-replay]')) {
    const since = ctx.away.since;
    ctx.away = null;
    timeline.playFrom(since);
    return render();
  }
  if (e.target.closest('[data-away-close]')) {
    ctx.away = null;
    return render();
  }
  if (e.target.closest('[data-alert-more]')) {
    ctx.alertsOpen = !ctx.alertsOpen;
    return render();
  }
  const row = e.target.closest('.alert');
  if (!row) return undefined;
  if (row.dataset.alertKind === 'stale' && row.dataset.alertAgent) ctx.focusAgent(row.dataset.alertAgent);
  if (row.dataset.alertBlock) ctx.select(row.dataset.alertBlock);
  return undefined;
});
$('alerts').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.alert[role="button"]')) {
    e.preventDefault();
    e.target.click();
  }
});

// ---------------------------------------------------------------------------------------- attention

// The tab title carries how many agents wait on the human, so a background tab still says so. With the bell
// on, an agent starting to wait, or an edit inside someone else's block, becomes a desktop notification.
const seen = { needs: new Set(), alerts: new Set(), primed: false };
function paintAttention() {
  if (!ctx.live || !ctx.board) return;
  const now = Date.now();
  const waiting = Object.values(ctx.live.agents).filter((a) => a.id !== HUMAN && !a.leftAt && needsHuman(ctx.live, a.id, now));
  const count = ctx.replayTs ? waiting.length : ctx.inboxCount || 0;
  document.title = `${count ? `(${count}) ` : ''}${ctx.board.name} Blockmap`;
  const conflicts = alerts(ctx.live, now).filter((a) => a.kind === 'trespass' || a.kind === 'frozen');
  if (seen.primed && notifyOn() && document.hidden) {
    for (const a of waiting) if (!seen.needs.has(a.id)) notify(`${a.name} needs you`, a.doing || openTitle(a));
    for (const c of conflicts) if (!seen.alerts.has(`${c.agent}|${c.block}`)) notify('Conflict', c.text);
  }
  seen.needs = new Set(waiting.map((a) => a.id));
  seen.alerts = new Set(conflicts.map((c) => `${c.agent}|${c.block}`));
  seen.primed = true;
}
function openTitle(a) {
  const q = Object.values(ctx.live.items).find((it) => it.kind === 'question' && it.by === a.id && it.status === 'open');
  return q ? q.title : '';
}
const canNotify = typeof Notification !== 'undefined';
const notifyOn = () => canNotify && Notification.permission === 'granted' && storageGet('blockmap.notify', false);
function notify(title, body) {
  try {
    new Notification(title, { body, tag: `${title}|${body}` });
  } catch {
    // Some browsers only notify from a service worker; the title count still shows it.
  }
}
const bell = h('button', { class: 'icon-btn', id: 'bell', type: 'button', hidden: !canNotify, html: icon('bell') });
function paintBell() {
  const on = notifyOn();
  bell.setAttribute('aria-pressed', String(on));
  bell.setAttribute('aria-label', on ? 'Notifications on' : 'Notify me');
  bell.title = on ? 'Notifications on' : 'Notify me';
}
bell.addEventListener('click', async () => {
  if (notifyOn()) storageSet('blockmap.notify', false);
  else {
    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = 'denied';
      }
    }
    if (perm === 'granted') storageSet('blockmap.notify', true);
    else toast('The browser blocked notifications for this page.');
  }
  paintBell();
});
$('theme-tools').prepend(bell);
paintBell();

// On a phone the palette, theme and bell fold into one menu button.
const menuBtn = $('menu-btn');
menuBtn.innerHTML = icon('dots');
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = !$('theme-tools').classList.contains('open');
  $('theme-tools').classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#theme-tools') && $('theme-tools').classList.contains('open')) {
    $('theme-tools').classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
});

// Active only: the map keeps the blocks with something going on (held, queued, edited lately, failing, in a branch).
const activeBtn = $('active-only');
const paintActive = () => activeBtn.setAttribute('aria-pressed', String(!!ctx.activeOnly));
activeBtn.addEventListener('click', () => {
  ctx.activeOnly = !ctx.activeOnly;
  storageSet('blockmap.activeOnly', ctx.activeOnly);
  paintActive();
  ctx.map.refit();
  render();
});
paintActive();

// Coming back after a while: a one-line digest of what changed, with a replay from when you left.
const AWAY_MS = 3 * 60_000;
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) ctx.showAway(hiddenAt);
});

// ------------------------------------------------------------------------------- lens, search, theme

const lensSeg = $('lens');
for (const b of lensSeg.querySelectorAll('button')) {
  b.setAttribute('aria-pressed', String(b.dataset.lens === ctx.lens));
  b.addEventListener('click', () => {
    ctx.lens = b.dataset.lens;
    storageSet('blockmap.lens', ctx.lens);
    for (const x of lensSeg.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    render();
  });
}

$('search-ic').innerHTML = icon('search');
const search = $('search');
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  if (!q || !ctx.board) ctx.search = null;
  else if (/[/.]/.test(q) && !/\s/.test(q)) {
    const id = blockForPath(ctx.live.index, q);
    ctx.search = { matches: new Set(id ? [id] : []), exact: true, path: q };
  } else {
    const hits = ctx.board.blocks.filter((b) => `${b.name} ${b.id} ${(b.keywords || []).join(' ')} ${b.about || ''}`.toLowerCase().includes(q)).map((b) => b.id);
    ctx.search = { matches: new Set(hits), exact: hits.length === 1 };
  }
  render();
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ctx.search) {
    const [only] = ctx.search.matches;
    if (ctx.search.path) {
      if (only) {
        const b = ctx.live.blocks[only];
        toast(`${search.value.trim()} is in ${nameOf(only)}${b.holder ? `, held by ${agentName(ctx.live, b.holder)}` : ', free'}.`);
        ctx.select(only);
      } else toast('No block claims that path.');
    } else if (ctx.search.matches.size === 1) ctx.select(only);
  }
  if (e.key === 'Escape') {
    search.value = '';
    ctx.search = null;
    search.blur();
    render();
  }
});
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input,textarea,select');
  if (e.key === '/' && !typing) {
    e.preventDefault();
    search.focus();
  } else if (e.key === 'Escape' && !typing && inspector.id) inspector.close();
});

const themeBtn = $('theme');
const savedTheme = storageGet('blockmap.theme', null);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}
function paintThemeBtn() {
  themeBtn.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
  themeBtn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Light theme' : 'Dark theme');
}
themeBtn.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  storageSet('blockmap.theme', next);
  paintThemeBtn();
  usePalette(palettePick.value);
});
paintThemeBtn();

// Solenoid's palettes. Default lives in the stylesheet; another one writes its vars onto the root.
const palettePick = $('palette');
for (const name of PALETTE_NAMES) palettePick.append(h('option', { value: name }, name));
function usePalette(name) {
  const root = document.documentElement;
  if (name === 'Default') {
    for (const prop of [...root.style]) if (prop.startsWith('--')) root.style.removeProperty(prop);
    delete root.dataset.palette;
  } else applyPalette(name);
  render();
}
palettePick.value = PALETTE_NAMES.includes(storageGet('blockmap.palette', 'Default')) ? storageGet('blockmap.palette', 'Default') : 'Default';
palettePick.addEventListener('change', () => {
  storageSet('blockmap.palette', palettePick.value);
  usePalette(palettePick.value);
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  paintThemeBtn();
  usePalette(palettePick.value);
});
usePalette(palettePick.value);

// -------------------------------------------------------------------------------------------- boot

async function boot() {
  try {
    const src = await connect({
      onBoard: (board) => setBoard(board, ctx.events),
      onReset: (events) => setBoard(ctx.board, events),
      onEvents: (list) => {
        for (const e of list) {
          ctx.events.push(e);
          index(e);
          apply(ctx.live, e);
        }
        render();
      },
      onWorktrees: (snap) => {
        ctx.worktrees = snap;
        render();
      },
      onStatus: (s, message) => {
        if (s === 'problem') return toast(message, 'error');
        ctx.connState = s;
        render();
      },
    });
    ctx.source = src;
    ctx.mode = src.mode;
    ctx.connState = src.mode;
    setBoard(src.board, src.events);
  } catch (err) {
    $('map').textContent = '';
    $('map').append(h('p', { class: 'boot' }, `The board didn't load: ${err.message}`));
    setText($('board-name'), 'not connected');
  }
}

setInterval(render, 5000);
startTimers(() => ctx.viewNow && ctx.replayTs ? ctx.replayTs : Date.now());
window.addEventListener('resize', render);
boot();

// For scripts that drive the page (screenshots, tests).
window.blockmap = ctx;
