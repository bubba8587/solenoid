// The Blockmap model: an append-only log of events folded into the board's state.
// Runs unchanged in Node (CLI, hooks, server) and in the browser (the board UI, the replay).
//
// The log is the truth. State is never saved; it is the fold of the log over the board config,
// so the timeline can replay any moment, and a board change (a block renamed, a path moved)
// re-maps old activity the next time anything folds it.

import { compileIndex, blockForPath, normalizePath } from './glob.js';

export const SCHEMA = 1;
export const HUMAN = 'human';
export const UNMAPPED = '_unmapped';
// Agents are colored by palette slot, not by hex, so a palette change recolors them. Gold, green and vermilion
// stay out: they mean needs-you, ok and danger. Gray is the human. The five cool hues go first; pink, amber and
// lime sit near the status colors and are used only past five agents.
export const PALETTE = ['sky', 'violet', 'teal', 'purple', 'blue', 'pink', 'amber', 'lime'];
// waiting: the agent needs the human (a question, a permission prompt). review: its turn ended and it waits for the
// next prompt. Both count as needing the human, and neither goes stale until four times the usual quiet.
export const AGENT_STATUS = ['working', 'idle', 'blocked', 'waiting', 'review', 'done'];
export const NEEDS_HUMAN = ['waiting', 'review'];
export const ITEM_KINDS = ['task', 'bug', 'question', 'decision', 'note'];
export const ITEM_STATUS = ['open', 'doing', 'blocked', 'done', 'wontfix'];
export const OUTCOMES = ['landed', 'parked', 'handoff', 'dropped', 'taken'];
const KIND_PREFIX = { task: 'T', bug: 'B', question: 'Q', decision: 'D', note: 'N' };
const KEEP = 48;

const CODENAMES = [
  'Heron', 'Basalt', 'Juniper', 'Quill', 'Marten', 'Cobalt', 'Fennel', 'Sable', 'Wren', 'Ochre',
  'Tamarack', 'Lumen', 'Pike', 'Saffron', 'Birch', 'Flint', 'Moss', 'Vesper', 'Otter', 'Cinder',
  'Talus', 'Kestrel', 'Larch', 'Alder', 'Bramble', 'Corvid', 'Dune', 'Ember', 'Gannet', 'Hazel',
];

export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function codename(id) {
  return CODENAMES[hash(String(id)) % CODENAMES.length];
}

export function eventId(now, rand = Math.random) {
  return `${Math.floor(now).toString(36)}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// State

export function createState(board) {
  const blocks = {};
  for (const b of board.blocks) blocks[b.id] = freshBlock(b.id);
  blocks[UNMAPPED] = freshBlock(UNMAPPED);
  const items = {};
  for (const it of board.items || []) items[it.id] = { status: 'open', source: 'import', history: [], ...it };
  const state = {
    board,
    index: compileIndex(board.blocks),
    blocks,
    agents: {},
    items,
    trespass: [],
    notes: [],
    queueSeq: 0,
    count: 0,
    firstTs: 0,
    lastTs: 0,
    staleMs: (board.staleAfterMin ?? 30) * 60_000,
  };
  ensureAgent(state, HUMAN, 0, { name: board.human?.name || 'You', kind: 'human' });
  return state;
}

function freshBlock(id) {
  return { id, holder: null, since: 0, intent: '', watchers: {}, queued: null, frozen: null, touches: [], test: null, history: [], added: 0, removed: 0 };
}

function ensureAgent(state, id, ts, info = {}) {
  let a = state.agents[id];
  if (!a) {
    a = state.agents[id] = {
      id,
      name: info.name || (id === HUMAN ? 'You' : codename(id)),
      kind: info.kind || (id === HUMAN ? 'human' : id.startsWith('cc-') ? 'claude-code' : 'agent'),
      color: info.color || pickColor(state, id),
      model: info.model || '',
      where: info.where || '',
      task: '',
      status: 'idle',
      statusSince: ts,
      doing: '',
      joinedAt: ts,
      lastSeen: ts,
      leftAt: 0,
      held: [],
      watching: [],
      touches: [],
      inbox: [],
      asked: [],
      edits: 0,
      added: 0,
      removed: 0,
      tests: 0,
      lastRun: null,
    };
  }
  return a;
}

function pickColor(state, id) {
  if (id === HUMAN) return '';
  // The first slot no present agent wears, in PALETTE's order, so the first agents get the cool hues.
  const used = new Set(Object.values(state.agents).filter((a) => !a.leftAt).map((a) => a.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[hash(id) % PALETTE.length];
}

function setStatus(a, status, ts) {
  if (a.status !== status) a.statusSince = ts;
  a.status = status;
}

function push(list, entry) {
  list.push(entry);
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
}

function addUnique(list, v) {
  if (!list.includes(v)) list.push(v);
}

function remove(list, v) {
  const i = list.indexOf(v);
  if (i >= 0) list.splice(i, 1);
}

function releaseInternal(state, b, ts, outcome, note, by) {
  const holder = b.holder;
  if (!holder) return;
  b.history.push({ agent: holder, from: b.since, to: ts, outcome: outcome || 'parked', intent: b.intent, note: note || '', by });
  const a = state.agents[holder];
  if (a) remove(a.held, b.id);
  b.holder = null;
  b.since = 0;
  b.intent = '';
}

// ---------------------------------------------------------------------------------------------
// The fold

export function reduce(board, events, untilTs = Infinity) {
  const state = createState(board);
  for (const e of events) {
    if (e.ts > untilTs) break;
    apply(state, e);
  }
  return state;
}

export function apply(state, e) {
  state.count++;
  if (!state.firstTs) state.firstTs = e.ts;
  state.lastTs = Math.max(state.lastTs, e.ts);
  const actor = e.by || HUMAN;
  const me = ensureAgent(state, actor, e.ts, e.type === 'agent.join' ? e.agent : undefined);
  me.lastSeen = Math.max(me.lastSeen, e.ts);
  if (me.leftAt && e.type !== 'agent.leave' && actor !== HUMAN) me.leftAt = 0;
  const target = e.agent && typeof e.agent === 'string' ? ensureAgent(state, e.agent, e.ts) : me;

  switch (e.type) {
    case 'agent.join': {
      const info = e.agent || {};
      for (const k of ['name', 'kind', 'model', 'where', 'color']) if (info[k]) me[k] = info[k];
      if (me.leftAt || !me.joinedAt) me.joinedAt = e.ts;
      me.leftAt = 0;
      if (e.task) me.task = e.task;
      setStatus(me, e.task ? 'working' : 'idle', e.ts);
      break;
    }
    case 'agent.status': {
      if (e.status) setStatus(target, e.status, e.ts);
      if (e.doing !== undefined) target.doing = e.doing;
      if (e.task !== undefined) target.task = e.task;
      if (e.name) target.name = e.name;
      break;
    }
    case 'agent.beat':
      break;
    case 'agent.leave': {
      for (const id of [...target.held]) releaseInternal(state, state.blocks[id], e.ts, e.outcome || 'parked', e.note, actor);
      for (const id of target.watching) if (state.blocks[id]) delete state.blocks[id].watchers[target.id];
      target.watching = [];
      target.leftAt = e.ts;
      setStatus(target, 'done', e.ts);
      target.doing = e.note || '';
      break;
    }
    case 'block.reserve': {
      const b = state.blocks[e.block];
      if (!b) break;
      if (e.mode === 'watch') {
        b.watchers[target.id] = e.ts;
        addUnique(target.watching, b.id);
        break;
      }
      if (b.holder === target.id) {
        if (e.intent) b.intent = e.intent;
        break;
      }
      if (b.holder) releaseInternal(state, b, e.ts, 'taken', `taken by ${target.name}`, actor);
      b.holder = target.id;
      b.since = e.ts;
      b.intent = e.intent || b.queued?.note || '';
      b.queued = null;
      delete b.watchers[target.id];
      remove(target.watching, b.id);
      addUnique(target.held, b.id);
      if (target.id !== HUMAN && target.status !== 'blocked') setStatus(target, 'working', e.ts);
      break;
    }
    case 'block.release': {
      const b = state.blocks[e.block];
      if (!b) break;
      if (b.watchers[target.id] && b.holder !== target.id) {
        delete b.watchers[target.id];
        remove(target.watching, b.id);
        break;
      }
      if (b.holder && (b.holder === target.id || e.force || actor === HUMAN)) {
        releaseInternal(state, b, e.ts, e.outcome, e.note, actor);
      }
      break;
    }
    case 'block.queue': {
      const b = state.blocks[e.block];
      if (b) b.queued = { ts: e.ts, note: e.note || '', pos: ++state.queueSeq, by: actor };
      break;
    }
    case 'block.unqueue': {
      const b = state.blocks[e.block];
      if (b) b.queued = null;
      break;
    }
    case 'block.freeze': {
      const b = state.blocks[e.block];
      if (b) b.frozen = e.on === false ? null : { ts: e.ts, note: e.note || '', by: actor };
      break;
    }
    case 'item.add': {
      const it = e.item;
      if (!it?.id) break;
      state.items[it.id] = {
        kind: 'task',
        block: null,
        detail: '',
        ...it,
        status: it.status || 'open',
        source: 'board',
        createdAt: e.ts,
        by: actor,
        history: [],
      };
      if (it.kind === 'question') {
        addUnique(me.asked, it.id);
        if (actor !== HUMAN) setStatus(me, 'waiting', e.ts);
      }
      break;
    }
    case 'item.update': {
      const it = state.items[e.item];
      if (!it) break;
      const before = it.status;
      for (const k of ['status', 'title', 'block', 'assignee', 'answer', 'detail']) if (e[k] !== undefined) it[k] = e[k];
      it.history.push({ ts: e.ts, by: actor, status: it.status, note: e.note || '' });
      if (it.kind === 'question' && e.answer && it.by && state.agents[it.by]) {
        const asker = state.agents[it.by];
        asker.inbox.push({ id: e.id, ts: e.ts, from: actor, text: `Answer to ${it.id} (${it.title}): ${e.answer}` });
        if (it.status === 'open') it.status = 'done';
      }
      if (it.kind === 'question' && it.status !== 'open' && before === 'open' && it.by && state.agents[it.by]) {
        const asker = state.agents[it.by];
        remove(asker.asked, it.id);
        if (asker.status === 'waiting' && !asker.asked.length) setStatus(asker, 'working', e.ts);
      }
      break;
    }
    case 'touch': {
      const op = e.op || 'edit';
      if (op === 'run') {
        target.lastRun = { ts: e.ts, cmd: e.cmd || '' };
        push(target.touches, { ts: e.ts, op, cmd: e.cmd || '', block: null, file: '' });
        break;
      }
      for (const raw of e.files || []) {
        const file = normalizePath(raw);
        const id = blockForPath(state.index, file) || UNMAPPED;
        const b = state.blocks[id];
        push(b.touches, { ts: e.ts, agent: target.id, file, op });
        push(target.touches, { ts: e.ts, file, block: id, op });
        if (op === 'edit') {
          target.edits++;
          // Line counts ride on a single-file edit (the hooks measure them); a multi-file touch carries none.
          if ((e.files || []).length === 1) {
            target.added += e.add || 0;
            target.removed += e.del || 0;
            b.added += e.add || 0;
            b.removed += e.del || 0;
          }
          if (b.holder && b.holder !== target.id) {
            push(state.trespass, { ts: e.ts, agent: target.id, block: id, holder: b.holder, file, kind: 'held' });
          } else if (b.frozen) {
            push(state.trespass, { ts: e.ts, agent: target.id, block: id, holder: null, file, kind: 'frozen' });
          }
        }
      }
      break;
    }
    case 'test': {
      let ids = e.blocks && e.blocks.length ? e.blocks : [...target.held];
      if (!ids.length) ids = recentBlocks(target, e.ts, 15 * 60_000);
      for (const id of ids) {
        const b = state.blocks[id];
        if (b) b.test = { ok: !!e.ok, ts: e.ts, summary: e.summary || '', agent: target.id };
      }
      target.tests++;
      break;
    }
    case 'note': {
      push(state.notes, { ts: e.ts, agent: target.id, text: e.text || '', block: e.block || null });
      break;
    }
    case 'msg': {
      const to = e.to === '*' ? Object.values(state.agents).filter((a) => !a.leftAt && a.id !== HUMAN) : [state.agents[e.to]].filter(Boolean);
      for (const a of to) a.inbox.push({ id: e.id, ts: e.ts, from: actor, text: e.text || '' });
      break;
    }
    case 'msg.read': {
      const ids = new Set(e.ids || []);
      target.inbox = target.inbox.filter((m) => !ids.has(m.id) && !(e.upTo && m.ts <= e.upTo));
      break;
    }
    default:
      break;
  }
  return state;
}

function recentBlocks(agent, now, windowMs) {
  const out = [];
  for (let i = agent.touches.length - 1; i >= 0; i--) {
    const t = agent.touches[i];
    if (now - t.ts > windowMs) break;
    if (t.block && t.block !== UNMAPPED && !out.includes(t.block)) out.push(t.block);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reading the state

export function blockMeta(state, id) {
  if (id === UNMAPPED) return { id, name: 'Unmapped files', district: null, about: 'Files no block claims. Add them to a block in the board config.' };
  return state.board.blocks.find((b) => b.id === id) || null;
}

export function agentName(state, id) {
  return state.agents[id]?.name || (id === HUMAN ? 'You' : codename(id));
}

export function isStale(state, agentId, now) {
  const a = state.agents[agentId];
  if (!a || agentId === HUMAN) return false;
  if (a.leftAt) return true;
  return now - a.lastSeen > quietLimit(state, a);
}

function quietLimit(state, a) {
  return NEEDS_HUMAN.includes(a.status) ? state.staleMs * 4 : state.staleMs;
}

// Whether the agent is waiting on the human right now: a question, a permission prompt, or a finished turn.
export function needsHuman(state, agentId, now) {
  const p = presence(state, agentId, now);
  return p === 'waiting' || p === 'review';
}

// What an agent's window shows as its state.
export function presence(state, agentId, now) {
  const a = state.agents[agentId];
  if (!a) return 'gone';
  if (agentId === HUMAN) return 'here';
  if (a.leftAt) return 'gone';
  if (now - a.lastSeen > quietLimit(state, a)) return 'stale';
  if (openQuestions(state, agentId).length) return 'waiting';
  return a.status;
}

// When the state presence() reports began: the timer an agent's window runs.
export function presenceSince(state, agentId, now) {
  const a = state.agents[agentId];
  if (!a) return now;
  const p = presence(state, agentId, now);
  if (p === 'gone') return a.leftAt;
  if (p === 'stale') return a.lastSeen;
  const asked = openQuestions(state, agentId).map((q) => q.createdAt);
  if (p === 'waiting' && asked.length) return Math.min(...asked);
  return a.statusSince || a.joinedAt;
}

export function openQuestions(state, agentId) {
  return Object.values(state.items).filter((it) => it.kind === 'question' && it.by === agentId && it.status === 'open');
}

export function heat(block, now, halfLifeMs = 20 * 60_000) {
  let h = 0;
  for (const t of block.touches) {
    const age = Math.max(0, now - t.ts);
    const w = t.op === 'edit' ? 1 : t.op === 'read' ? 0.3 : 0.2;
    h += w * 0.5 ** (age / halfLifeMs);
  }
  return h;
}

export function itemCounts(state, blockId) {
  const c = { bug: 0, task: 0, decision: 0, question: 0, note: 0, open: 0, doing: 0, done: 0 };
  for (const it of Object.values(state.items)) {
    if (it.block !== blockId) continue;
    if (it.status === 'done' || it.status === 'wontfix') {
      c.done++;
      continue;
    }
    c[it.kind] = (c[it.kind] || 0) + 1;
    c.open++;
    if (it.status === 'doing') c.doing++;
  }
  return c;
}

export function recentToucher(block, now, windowMs = 30 * 60_000) {
  for (let i = block.touches.length - 1; i >= 0; i--) {
    const t = block.touches[i];
    if (now - t.ts > windowMs) return null;
    if (t.agent) return t.agent;
  }
  return null;
}

// Agents (other than the holder) who touched the block lately: footprints on the tile.
export function footprints(block, now, windowMs = 60 * 60_000) {
  const seen = new Set();
  for (let i = block.touches.length - 1; i >= 0; i--) {
    const t = block.touches[i];
    if (now - t.ts > windowMs) break;
    if (t.agent && t.agent !== block.holder) seen.add(t.agent);
  }
  return [...seen];
}

export function alerts(state, now) {
  const out = [];
  const seen = new Set();
  for (let i = state.trespass.length - 1; i >= 0; i--) {
    const t = state.trespass[i];
    if (now - t.ts > 3 * 3600_000) break;
    const key = `${t.agent}|${t.block}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const b = state.blocks[t.block];
    if (t.kind === 'held' && b.holder !== t.holder) continue;
    if (t.kind === 'frozen' && !b.frozen) continue;
    const name = blockMeta(state, t.block)?.name || t.block;
    out.push({
      kind: t.kind === 'frozen' ? 'frozen' : 'trespass',
      severity: 'high',
      ts: t.ts,
      block: t.block,
      agent: t.agent,
      text:
        t.kind === 'frozen'
          ? `${agentName(state, t.agent)} edited ${t.file.split('/').pop()} in frozen ${name}`
          : `${agentName(state, t.agent)} edited ${t.file.split('/').pop()} in ${agentName(state, t.holder)}'s ${name}`,
    });
  }
  for (const b of Object.values(state.blocks)) {
    if (b.holder && b.holder !== HUMAN && isStale(state, b.holder, now)) {
      const a = state.agents[b.holder];
      out.push({
        kind: 'stale',
        severity: 'medium',
        ts: a.lastSeen,
        block: b.id,
        agent: b.holder,
        text: `${a.name} went quiet holding ${blockMeta(state, b.id)?.name || b.id}`,
      });
    }
    if (b.test && !b.test.ok && now - b.test.ts < 6 * 3600_000) {
      out.push({
        kind: 'failing',
        severity: 'high',
        ts: b.test.ts,
        block: b.id,
        agent: b.test.agent,
        text: `${blockMeta(state, b.id)?.name || b.id}: ${b.test.summary || 'tests fail'}`,
      });
    }
  }
  for (const it of Object.values(state.items)) {
    if (it.kind === 'question' && it.status === 'open' && it.by && it.by !== HUMAN) {
      out.push({ kind: 'question', severity: 'medium', ts: it.createdAt, block: it.block, agent: it.by, item: it.id, text: `${agentName(state, it.by)} asks: ${it.title}` });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.ts - a.ts);
}

export function queue(state) {
  return Object.values(state.blocks)
    .filter((b) => b.queued)
    .sort((a, b) => a.queued.pos - b.queued.pos);
}

// ---------------------------------------------------------------------------------------------
// Finding blocks by what people type

export function findBlock(state, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { error: 'Name a block.' };
  const blocks = state.board.blocks;
  const exact = blocks.find((b) => b.id.toLowerCase() === q || b.name.toLowerCase() === q);
  if (exact) return { block: exact };
  const hits = blocks.filter((b) => b.id.toLowerCase().includes(q) || b.name.toLowerCase().includes(q) || (b.keywords || []).some((k) => k.toLowerCase() === q));
  if (hits.length === 1) return { block: hits[0] };
  if (hits.length > 1) return { error: `"${query}" matches ${hits.length} blocks: ${hits.map((b) => b.id).join(', ')}.`, suggestions: hits.map((b) => b.id) };
  const close = blocks
    .map((b) => ({ b, d: Math.min(distance(q, b.id.toLowerCase()), distance(q, b.name.toLowerCase())) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map((x) => x.b.id);
  return { error: `No block named "${query}". Closest: ${close.join(', ')}. \`bm blocks\` lists them all.`, suggestions: close };
}

function distance(a, b) {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

// ---------------------------------------------------------------------------------------------
// Making and checking events (the CLI and the server call these under the store's lock)

export function makeEvent(state, type, by, payload = {}, now = Date.now(), rand = Math.random) {
  const e = { id: eventId(now, rand), ts: Math.floor(now), by: by || HUMAN, type, ...payload };
  if (type === 'item.add' && e.item && !e.item.id) {
    const prefix = KIND_PREFIX[e.item.kind] || 'T';
    let n = 0;
    for (const id of Object.keys(state.items)) {
      const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
      if (m) n = Math.max(n, Number(m[1]));
    }
    e.item = { ...e.item, id: `${prefix}${n + 1}` };
  }
  return e;
}

// Returns null when the event may be appended, or a sentence saying why not and what to do.
export function checkEvent(state, e, now = Date.now()) {
  const actor = e.by || HUMAN;
  const who = typeof e.agent === 'string' ? e.agent : actor;
  switch (e.type) {
    case 'block.reserve': {
      const b = state.blocks[e.block];
      if (!b || e.block === UNMAPPED) return `No block named "${e.block}".`;
      if (e.mode === 'watch') return null;
      const name = blockMeta(state, e.block).name;
      if (b.frozen && actor !== HUMAN && !e.force) {
        return `${name} is frozen${b.frozen.note ? ` (${b.frozen.note})` : ''}. Ask the human to unfreeze it, or pick other work.`;
      }
      if (b.holder && b.holder !== who) {
        const h = state.agents[b.holder];
        if (b.holder === HUMAN && actor !== HUMAN && !e.force) {
          return `${name} is held by ${h.name} (the human)${b.intent ? `: ${b.intent}` : ''}. Pick other work or ask them.`;
        }
        if (!isStale(state, b.holder, now) && !e.force && actor !== HUMAN) {
          return `${name} is held by ${h.name} since ${clock(b.since)}${b.intent ? ` for "${b.intent}"` : ''}. Message them with \`bm note\`, pick other work, or wait: a holder unseen for ${Math.round(state.staleMs / 60_000)} min can be taken over.`;
        }
      }
      return null;
    }
    case 'block.release': {
      const b = state.blocks[e.block];
      if (!b) return `No block named "${e.block}".`;
      if (b.watchers[who]) return null;
      if (!b.holder) return `${blockMeta(state, e.block).name} isn't held by anyone.`;
      if (b.holder !== who && actor !== HUMAN && !e.force) return `${blockMeta(state, e.block).name} is held by ${agentName(state, b.holder)}, not you.`;
      return null;
    }
    case 'block.queue':
    case 'block.unqueue':
    case 'block.freeze':
      return state.blocks[e.block] ? null : `No block named "${e.block}".`;
    case 'item.add':
      if (!e.item?.title) return 'An item needs a title.';
      if (e.item.block && !state.blocks[e.item.block]) return `No block named "${e.item.block}".`;
      if (e.item.kind && !ITEM_KINDS.includes(e.item.kind)) return `Kinds are ${ITEM_KINDS.join(', ')}.`;
      return null;
    case 'item.update':
      if (!state.items[e.item]) return `No item ${e.item}.`;
      if (e.status && !ITEM_STATUS.includes(e.status)) return `Statuses are ${ITEM_STATUS.join(', ')}.`;
      return null;
    case 'agent.status':
      if (e.status && !AGENT_STATUS.includes(e.status)) return `Statuses are ${AGENT_STATUS.join(', ')}.`;
      return null;
    case 'msg':
      if (!e.text) return 'A message needs text.';
      if (e.to !== '*' && !state.agents[e.to]) return `No agent "${e.to}".`;
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Words

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `${Math.round(h / 24)} days`;
}

export function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function describeEvent(state, e) {
  const who = agentName(state, typeof e.agent === 'string' ? e.agent : e.by || HUMAN);
  const by = agentName(state, e.by || HUMAN);
  const block = (id) => blockMeta(state, id)?.name || id;
  const onBehalf = typeof e.agent === 'string' && e.agent !== e.by ? ` (by ${by})` : '';
  switch (e.type) {
    case 'agent.join':
      return `${who} joined${e.task ? `: ${e.task}` : ''}`;
    case 'agent.leave':
      return `${who} left${e.note ? `: ${e.note}` : ''}`;
    case 'agent.status':
      return e.doing ? `${who}: ${e.doing}` : `${who} is ${e.status || 'updated'}`;
    case 'agent.beat':
      return `${who} checked in`;
    case 'block.reserve':
      return e.mode === 'watch' ? `${who} is watching ${block(e.block)}` : `${who} reserved ${block(e.block)}${e.intent ? `: ${e.intent}` : ''}${onBehalf}`;
    case 'block.release':
      return `${who} released ${block(e.block)}${e.outcome ? ` (${e.outcome})` : ''}${e.note ? `: ${e.note}` : ''}${onBehalf}`;
    case 'block.queue':
      return `${by} queued ${block(e.block)}${e.note ? `: ${e.note}` : ''}`;
    case 'block.unqueue':
      return `${by} took ${block(e.block)} off the queue`;
    case 'block.freeze':
      return e.on === false ? `${by} unfroze ${block(e.block)}` : `${by} froze ${block(e.block)}${e.note ? `: ${e.note}` : ''}`;
    case 'item.add':
      return `${by} filed ${e.item.kind || 'task'} ${e.item.id}${e.item.block ? ` in ${block(e.item.block)}` : ''}: ${e.item.title}`;
    case 'item.update':
      return `${by} set ${e.item} to ${e.status || 'updated'}${e.answer ? `: ${e.answer}` : ''}`;
    case 'touch':
      if (e.op === 'run') return `${who} ran ${e.cmd || 'a command'}`;
      return `${who} ${e.op === 'read' ? 'read' : 'edited'} ${(e.files || []).join(', ')}`;
    case 'test':
      return `${who}: tests ${e.ok ? 'pass' : 'fail'}${e.summary ? ` (${e.summary})` : ''}`;
    case 'note':
      return `${who}: ${e.text}`;
    case 'msg':
      return `${by} to ${e.to === '*' ? 'everyone' : agentName(state, e.to)}: ${e.text}`;
    case 'msg.read':
      return `${who} read their messages`;
    default:
      return `${who}: ${e.type}`;
  }
}
