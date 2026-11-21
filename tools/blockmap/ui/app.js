// The board page: folds the log into state, renders the map, the windows, the timeline and the
// inspector from it, and turns what the person does (drag a tile, answer a question) into events.

import { HUMAN, apply, reduce, alerts, presence, blockMeta, agentName, ago } from '../core/model.js';
import { blockForPath } from '../core/glob.js';
import { connect } from './source.js';
import { createMap } from './map.js';
import { createSide } from './windows.js';
import { createTimeline } from './timeline.js';
import { createInspector } from './inspector.js';
import { createTethers } from './tethers.js';
import { enableDnd } from './dnd.js';
import { h, icon, setHtml, setText, toast, storageGet, storageSet, esc } from './dom.js';

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

function computeView() {
  if (ctx.replayTs) {
    ctx.view = reduce(ctx.board, ctx.events, ctx.replayTs);
    ctx.viewNow = ctx.replayTs;
  } else {
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
      if (b.holder !== HUMAN) list.push({ type: 'msg', to: b.holder, text: `Moved ${nameOf(block)} (${block}) to ${agentName(ctx.live, agent)}. Stop editing there.` });
    }
    list.push({ type: 'block.reserve', agent, block, intent: b.intent || b.queued?.note || '' });
    if (agent !== HUMAN) list.push({ type: 'msg', to: agent, text: `Assigned to you: ${nameOf(block)} (${block}). \`bm show ${block}\` lists its docs and open items.` });
    return commit(list, agent === HUMAN ? `You hold ${nameOf(block)}. Agents stay out.` : `Gave ${nameOf(block)} to ${agentName(ctx.live, agent)}.`);
  },
  release(block) {
    const b = ctx.live.blocks[block];
    if (!b.holder) return Promise.resolve(false);
    const list = [{ type: 'block.release', agent: b.holder, block, outcome: 'parked', note: `released by ${humanName()}` }];
    if (b.holder !== HUMAN) list.push({ type: 'msg', to: b.holder, text: `Took ${nameOf(block)} (${block}) back. Stop editing there.` });
    return commit(list, `${nameOf(block)} is free.`);
  },
  queue(block) {
    const b = ctx.live.blocks[block];
    const list = [];
    if (b.holder) {
      list.push({ type: 'block.release', agent: b.holder, block, outcome: 'parked', note: 'moved to the queue' });
      if (b.holder !== HUMAN) list.push({ type: 'msg', to: b.holder, text: `Moved ${nameOf(block)} (${block}) back to the queue. Stop editing there.` });
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
};

// ------------------------------------------------------------------------------------------ render

let raf = 0;
function render() {
  if (!raf) raf = requestAnimationFrame(doRender);
}

function doRender() {
  raf = 0;
  if (!ctx.view) return;
  if (!ctx.replayTs) {
    ctx.view = ctx.live;
    ctx.viewNow = Date.now();
  }
  const before = new Map();
  for (const [id, tile] of ctx.map.tiles) before.set(id, tile.getBoundingClientRect());
  document.body.dataset.lens = ctx.lens;
  document.body.classList.toggle('inspecting', !!inspector.id);
  side.update();
  ctx.map.fit();
  const moved = placeTiles();
  ctx.map.paint();
  paintTop();
  paintAlerts();
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
  if (!tiles.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  let need = 0;
  for (const it of Object.values(st.items)) {
    if (it.status === 'done' || it.status === 'wontfix') continue;
    if (it.kind === 'bug') bugs++;
    if (it.kind === 'decision' || it.kind === 'question') need++;
  }
  const al = alerts(st, now);
  setHtml(
    $('stats'),
    [
      `<span class="stat" title="Agents working now, of those on the board"><b>${working}</b><span>of ${agents.length} working</span></span>`,
      `<span class="stat" title="Blocks reserved right now"><b>${held}</b><span>of ${ctx.board.blocks.length} blocks held</span></span>`,
      `<span class="stat bug" title="Open bugs across the board"><b>${bugs}</b><span>bugs</span></span>`,
      `<span class="stat ask" title="Decisions and questions waiting on ${esc(st.agents[HUMAN].name)}"><b>${need}</b><span>need you</span></span>`,
      `<span class="stat ${al.length ? 'alert' : ''}" title="Trespasses, stale holders, failing tests, questions"><b>${al.length}</b><span>alert${al.length === 1 ? '' : 's'}</span></span>`,
    ].join(''),
  );
  const conn = $('conn');
  const mode = ctx.replayTs ? 'replay' : ctx.connState || ctx.mode;
  conn.className = `conn ${mode === 'live' ? 'live' : mode === 'demo' ? 'demo' : mode === 'replay' ? 'replay' : ''}`;
  setText(conn.lastElementChild, { live: 'Live', demo: 'Demo', replay: 'Replay', offline: 'Reconnecting', connecting: 'Connecting' }[mode] || mode);
}

function paintAlerts() {
  const host = $('alerts');
  const st = ctx.view;
  const now = ctx.viewNow;
  const al = alerts(st, now);
  const rows = [];
  if (ctx.mode === 'demo') {
    rows.push(
      `<div class="demo-note">${icon('live')}<span>Simulated agents working through the real ${esc(ctx.board.name)} backlog on its real map. Drag blocks between windows, answer a question, scrub the timeline. The live board is <code>tools/blockmap/bm serve</code>.</span></div>`,
    );
  }
  const shown = ctx.alertsOpen ? al : al.slice(0, 1);
  shown.forEach((a, i) => {
    const kind = a.kind === 'question' ? 'question' : a.severity;
    const more = i === 0 && al.length > 1 ? `<button class="more" type="button" data-alert-more>${ctx.alertsOpen ? 'Fewer' : `+${al.length - 1} more`}</button>` : '';
    rows.push(`<div class="alert ${kind}" data-alert-block="${esc(a.block || '')}" data-alert-agent="${esc(a.agent || '')}" data-alert-kind="${a.kind}"><span class="sev"></span><span class="txt" title="${esc(a.text)}">${esc(a.text)}</span><span class="when">${ago(now - a.ts)} ago</span>${more}<button type="button" data-alert-go>${a.kind === 'question' ? 'Answer' : 'Show'}</button></div>`);
  });
  setHtml(host, rows.join(''));
}

$('alerts').addEventListener('click', (e) => {
  if (e.target.closest('[data-alert-more]')) {
    ctx.alertsOpen = !ctx.alertsOpen;
    return render();
  }
  const row = e.target.closest('.alert');
  if (!row || !e.target.closest('[data-alert-go]')) return;
  if (row.dataset.alertKind === 'question' && row.dataset.alertAgent) return side.focusAnswer(row.dataset.alertAgent);
  if (row.dataset.alertBlock) ctx.select(row.dataset.alertBlock);
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
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function paintThemeBtn() {
  themeBtn.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
  themeBtn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light' : 'Switch to dark');
}
themeBtn.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  storageSet('blockmap.theme', next);
  paintThemeBtn();
  render();
});
paintThemeBtn();

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
window.addEventListener('resize', render);
boot();

// For scripts that drive the page (screenshots, tests).
window.blockmap = ctx;
