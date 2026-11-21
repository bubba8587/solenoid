#!/usr/bin/env node
// bm: the Blockmap command line. Agents reserve blocks, say what they're doing, file bugs and read
// the human's messages with it; `bm serve` opens the board. `bm help` lists everything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HUMAN, UNMAPPED, OUTCOMES, ITEM_STATUS, reduce, makeEvent, findBlock, blockMeta, agentName, presence, alerts, queue,
  itemCounts, describeEvent, ago, clock,
} from './core/model.js';
import { blockForPath, matchDetail, normalizePath } from './core/glob.js';
import { openStore, remoteStore, findBoardDir } from './core/store.js';
import { changedFiles } from './core/files.js';
import { whoAmI, whereAmI, agentKind } from './core/identity.js';


// ---------------------------------------------------------------------------------------------
// Arguments

function parse(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-') && !BOOLEAN.has(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (/^-[a-z]$/.test(a)) {
      const k = { n: 'n', f: 'follow', j: 'json' }[a[1]] || a[1];
      if (k === 'n') flags.n = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { cmd: pos.shift() || 'board', pos, flags };
}

const BOOLEAN = new Set(['json', 'watch', 'force', 'all', 'landed', 'parked', 'handoff', 'dropped', 'keep', 'staged', 'open', 'demo', 'follow', 'auto', 'quiet', 'peek']);

class Refusal extends Error {}

// ---------------------------------------------------------------------------------------------
// Plumbing

async function context(flags) {
  const url = flags.url || process.env.BLOCKMAP_URL;
  const store = url ? remoteStore(url) : openStore(findBoardDir());
  const { board, events } = await store.load();
  const now = Date.now();
  const state = reduce(board, events);
  const me = whoAmI(flags.as);
  return { store, board, events, state, me, now, flags };
}

async function commit(ctx, events) {
  try {
    const res = await ctx.store.commit(events);
    ctx.state = res.state;
    return res.events;
  } catch (err) {
    if (err.refused) throw new Refusal(err.message);
    throw err;
  }
}

// Agents that haven't joined join on their first command.
function joinIfNeeded(ctx, extra = {}) {
  const a = ctx.state.agents[ctx.me];
  if (ctx.me === HUMAN) return [];
  if (a && !a.leftAt && a.joinedAt) return [];
  return [
    makeEvent(ctx.state, 'agent.join', ctx.me, {
      agent: { id: ctx.me, name: extra.name || a?.name, kind: extra.kind || agentKind(ctx.me), model: extra.model || process.env.BLOCKMAP_MODEL || '', where: whereAmI() },
      task: extra.task || '',
    }, ctx.now),
  ];
}

function ev(ctx, type, payload) {
  return makeEvent(ctx.state, type, ctx.me, payload, ctx.now);
}

function needBlock(ctx, query) {
  const r = findBlock(ctx.state, query);
  if (r.error) throw new Refusal(r.error);
  return r.block;
}

function relPath(ctx, p) {
  const root = ctx.store.root;
  const abs = path.resolve(p);
  return normalizePath(abs.startsWith(root + path.sep) ? path.relative(root, abs) : p);
}

function defaultBlock(ctx) {
  const a = ctx.state.agents[ctx.me];
  if (!a) return null;
  for (let i = a.touches.length - 1; i >= 0; i--) if (a.touches[i].block && a.touches[i].block !== UNMAPPED) return a.touches[i].block;
  return a.held[0] || null;
}

const out = (ctx, text, json) => {
  if (ctx.flags.json) console.log(JSON.stringify(json ?? { ok: true }, null, 2));
  else if (!ctx.flags.quiet && text) console.log(text);
};

function words(pos) {
  return pos.join(' ').trim();
}

function docsLine(meta) {
  return meta?.docs?.length ? `Read first: ${meta.docs.join(', ')}.` : '';
}

function countsLine(ctx, id) {
  const c = itemCounts(ctx.state, id);
  const parts = [];
  if (c.bug) parts.push(`${c.bug} bug${c.bug > 1 ? 's' : ''}`);
  if (c.task) parts.push(`${c.task} task${c.task > 1 ? 's' : ''}`);
  if (c.decision) parts.push(`${c.decision} waiting on the human`);
  if (c.question) parts.push(`${c.question} open question${c.question > 1 ? 's' : ''}`);
  return parts.length ? `Open there: ${parts.join(', ')} (\`bm show ${id}\`).` : '';
}

// ---------------------------------------------------------------------------------------------
// Commands

const commands = {
  async board(ctx) {
    console.log(summary(ctx.state, ctx.now, ctx.me));
  },

  async join(ctx) {
    const { name, task, model, kind } = ctx.flags;
    const events = [];
    const a = ctx.state.agents[ctx.me];
    if (!a || a.leftAt || !a.joinedAt) events.push(...joinIfNeeded(ctx, { name, task, model, kind }));
    else events.push(ev(ctx, 'agent.join', { agent: { id: ctx.me, name, kind, model, where: whereAmI() }, task: task || a.task }));
    await commit(ctx, events);
    const me = ctx.state.agents[ctx.me];
    out(ctx, `You are ${me.name} (${me.id}) on the ${ctx.board.name} board.${me.task ? ` Task: ${me.task}.` : ''}\n${protocolHint()}`, me);
  },

  async leave(ctx) {
    const held = [...(ctx.state.agents[ctx.me]?.held || [])];
    await commit(ctx, [ev(ctx, 'agent.leave', { note: ctx.flags.note || '' })]);
    out(ctx, held.length ? `Left. Released ${held.join(', ')}.` : 'Left.', { released: held });
  },

  async doing(ctx) {
    const text = words(ctx.pos);
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'agent.status', { doing: text, status: 'working', ...(ctx.flags.task ? { task: ctx.flags.task } : {}) })]);
    out(ctx, `Doing: ${text}`);
  },

  async status(ctx) {
    const status = ctx.pos[0];
    const doing = ctx.flags.note ?? words(ctx.pos.slice(1));
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'agent.status', { status, ...(doing ? { doing } : {}) })]);
    out(ctx, `Status: ${status}${doing ? ` (${doing})` : ''}`);
  },

  async reserve(ctx) {
    if (!ctx.pos.length) throw new Refusal('Name the block(s) to reserve: `bm reserve <block> [--for "what you will do"]`.');
    const blocks = ctx.pos.map((q) => needBlock(ctx, q));
    const mode = ctx.flags.watch ? 'watch' : 'own';
    const intent = typeof ctx.flags.for === 'string' ? ctx.flags.for : '';
    const events = [...joinIfNeeded(ctx)];
    for (const b of blocks) events.push(ev(ctx, 'block.reserve', { block: b.id, mode, intent, ...(ctx.flags.force ? { force: true } : {}) }));
    await commit(ctx, events);
    const lines = blocks.map((b) => {
      const parts = [`${mode === 'watch' ? 'Watching' : 'Reserved'} ${b.name} (${b.id}).`, docsLine(b), countsLine(ctx, b.id)];
      return parts.filter(Boolean).join(' ');
    });
    out(ctx, lines.join('\n'), { reserved: blocks.map((b) => b.id), mode });
  },

  async release(ctx) {
    const a = ctx.state.agents[ctx.me];
    let ids;
    if (ctx.flags.all || !ctx.pos.length) ids = [...(a?.held || []), ...(a?.watching || [])];
    else ids = ctx.pos.map((q) => needBlock(ctx, q).id);
    if (!ids.length) return out(ctx, 'You hold nothing.', { released: [] });
    const outcome = OUTCOMES.find((o) => ctx.flags[o]) || ctx.flags.outcome || (ctx.flags.note ? 'parked' : 'landed');
    const note = typeof ctx.flags.note === 'string' ? ctx.flags.note : '';
    await commit(ctx, ids.map((id) => ev(ctx, 'block.release', { block: id, outcome, note })));
    out(ctx, `Released ${ids.join(', ')} (${outcome}).`, { released: ids, outcome });
  },

  async next(ctx) {
    const q = queue(ctx.state).filter((b) => !b.holder && !b.frozen);
    if (!q.length) return out(ctx, 'The queue is empty. `bm` shows the board; pick a free block and `bm reserve` it.', { block: null });
    const b = q[0];
    const meta = blockMeta(ctx.state, b.id);
    const intent = typeof ctx.flags.for === 'string' ? ctx.flags.for : b.queued.note;
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'block.reserve', { block: b.id, intent }), ...(b.queued.note ? [ev(ctx, 'agent.status', { task: b.queued.note, status: 'working' })] : [])]);
    out(ctx, [`Reserved ${meta.name} (${b.id}) from the queue.`, b.queued.note ? `The human's note: ${b.queued.note}` : '', docsLine(meta), countsLine(ctx, b.id)].filter(Boolean).join('\n'), { block: b.id, note: b.queued.note });
  },

  async which(ctx) {
    const rows = ctx.pos.map((p) => {
      const rel = relPath(ctx, p);
      const hit = matchDetail(ctx.state.index, rel);
      const b = hit ? ctx.state.blocks[hit.block] : null;
      return { path: rel, block: hit?.block || null, pattern: hit?.pattern || null, holder: b?.holder || null, frozen: !!b?.frozen };
    });
    out(
      ctx,
      rows
        .map((r) => {
          if (!r.block) return `${r.path}: no block claims it (add it to .blockmap/board.json)`;
          const meta = blockMeta(ctx.state, r.block);
          const held = r.holder ? `held by ${agentName(ctx.state, r.holder)}${r.holder === ctx.me ? ' (you)' : ''}` : 'free';
          return `${r.path}: ${meta.name} (${r.block}), ${held}${r.frozen ? ', frozen' : ''}`;
        })
        .join('\n'),
      rows,
    );
  },

  async show(ctx) {
    const meta = needBlock(ctx, words(ctx.pos));
    const b = ctx.state.blocks[meta.id];
    const items = Object.values(ctx.state.items).filter((it) => it.block === meta.id && it.status !== 'done' && it.status !== 'wontfix');
    const d = ctx.board.districts.find((x) => x.id === meta.district);
    const lines = [
      `${meta.name} (${meta.id}) · ${d?.name || meta.district}`,
      meta.about,
      b.holder ? `Held by ${agentName(ctx.state, b.holder)} since ${clock(b.since)}${b.intent ? `: ${b.intent}` : ''}` : 'Free.',
      b.frozen ? `Frozen by ${agentName(ctx.state, b.frozen.by)}${b.frozen.note ? `: ${b.frozen.note}` : ''}` : '',
      b.queued ? `Queued #${b.queued.pos}${b.queued.note ? `: ${b.queued.note}` : ''}` : '',
      b.test ? `Last test: ${b.test.ok ? 'pass' : 'FAIL'} ${ago(ctx.now - b.test.ts)} ago${b.test.summary ? ` (${b.test.summary})` : ''}` : '',
      meta.docs?.length ? `Docs: ${meta.docs.join(', ')}` : '',
      `Paths: ${meta.paths.join(', ')}`,
      items.length ? `\nOpen items (${items.length}):` : '\nNo open items.',
      ...items.slice(0, 40).map((it) => `  ${it.id.padEnd(9)} ${it.kind.padEnd(8)} ${it.status === 'open' ? '' : `[${it.status}] `}${it.title}`),
      b.touches.length ? '\nRecent activity:' : '',
      ...b.touches.slice(-8).reverse().map((t) => `  ${ago(ctx.now - t.ts).padStart(7)} ago  ${agentName(ctx.state, t.agent)} ${t.op} ${t.file}`),
    ];
    out(ctx, lines.filter((l) => l !== '').join('\n'), { block: meta, state: b, items });
  },

  async mine(ctx) {
    const a = ctx.state.agents[ctx.me];
    if (!a) return out(ctx, `You (${ctx.me}) haven't joined. \`bm join --name <name> --task "<task>"\`.`, null);
    const lines = [
      `${a.name} (${a.id}) · ${presence(ctx.state, a.id, ctx.now)}${a.task ? ` · ${a.task}` : ''}`,
      a.held.length ? `Holding: ${a.held.map((id) => `${blockMeta(ctx.state, id).name} (${id})`).join(', ')}` : 'Holding nothing.',
      a.watching.length ? `Watching: ${a.watching.join(', ')}` : '',
      a.inbox.length ? `${a.inbox.length} unread message${a.inbox.length > 1 ? 's' : ''}: \`bm inbox\`` : '',
    ];
    out(ctx, lines.filter(Boolean).join('\n'), a);
  },

  async touch(ctx) {
    const files = ctx.pos.map((p) => relPath(ctx, p));
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'touch', { files, op: ctx.flags.op || 'edit' })]);
    out(ctx, '', { files });
  },

  async test(ctx) {
    const verdict = ctx.pos[0];
    if (!['pass', 'fail'].includes(verdict)) throw new Refusal('`bm test pass|fail "<what ran>"`.');
    const blocks = ctx.flags.block ? [needBlock(ctx, ctx.flags.block).id] : undefined;
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'test', { ok: verdict === 'pass', summary: words(ctx.pos.slice(1)), ...(blocks ? { blocks } : {}) })]);
    out(ctx, `Recorded: tests ${verdict}.`);
  },

  async bug(ctx) {
    return fileItem(ctx, 'bug');
  },
  async task(ctx) {
    return fileItem(ctx, 'task');
  },
  async ask(ctx) {
    return fileItem(ctx, 'question');
  },

  async item(ctx) {
    const [id, status] = ctx.pos;
    const it = ctx.state.items[id];
    if (!it) throw new Refusal(`No item ${id}. \`bm show <block>\` lists a block's items.`);
    if (status && !ITEM_STATUS.includes(status)) throw new Refusal(`Statuses are ${ITEM_STATUS.join(', ')}.`);
    const payload = { item: id };
    if (status) payload.status = status;
    if (typeof ctx.flags.note === 'string') payload.note = ctx.flags.note;
    if (typeof ctx.flags.answer === 'string') payload.answer = ctx.flags.answer;
    if (ctx.flags.block) payload.block = needBlock(ctx, ctx.flags.block).id;
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'item.update', payload)]);
    out(ctx, `${id}: ${status || 'updated'}.`);
  },

  async inbox(ctx) {
    const a = ctx.state.agents[ctx.me];
    const msgs = a?.inbox || [];
    if (!msgs.length) return out(ctx, 'No messages.', []);
    if (!ctx.flags.keep && !ctx.flags.peek) await commit(ctx, [ev(ctx, 'msg.read', { ids: msgs.map((m) => m.id) })]);
    out(ctx, msgs.map((m) => `${clock(m.ts)} ${agentName(ctx.state, m.from)}: ${m.text}`).join('\n'), msgs);
  },

  async note(ctx) {
    const text = words(ctx.pos);
    if (ctx.flags.to) return commands.msg({ ...ctx, pos: [ctx.flags.to, ...ctx.pos] });
    const block = ctx.flags.block ? needBlock(ctx, ctx.flags.block).id : undefined;
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'note', { text, ...(block ? { block } : {}) })]);
    out(ctx, 'Noted on the board.');
  },

  async msg(ctx) {
    const [toQuery, ...rest] = ctx.pos;
    const to = toQuery === '*' || toQuery === 'all' ? '*' : resolveAgent(ctx, toQuery);
    await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'msg', { to, text: words(rest) })]);
    out(ctx, `Sent to ${to === '*' ? 'everyone' : agentName(ctx.state, to)}.`);
  },

  async queue(ctx) {
    if (!ctx.pos.length) {
      const q = queue(ctx.state);
      return out(ctx, q.length ? q.map((b) => `#${b.queued.pos} ${blockMeta(ctx.state, b.id).name} (${b.id})${b.queued.note ? `: ${b.queued.note}` : ''}`).join('\n') : 'The queue is empty.', q);
    }
    const b = needBlock(ctx, ctx.pos[0]);
    await commit(ctx, [ev(ctx, 'block.queue', { block: b.id, note: words(ctx.pos.slice(1)) || ctx.flags.note || '' })]);
    out(ctx, `Queued ${b.name}.`);
  },
  async unqueue(ctx) {
    const b = needBlock(ctx, ctx.pos[0]);
    await commit(ctx, [ev(ctx, 'block.unqueue', { block: b.id })]);
    out(ctx, `${b.name} is off the queue.`);
  },
  async freeze(ctx) {
    const b = needBlock(ctx, ctx.pos[0]);
    await commit(ctx, [ev(ctx, 'block.freeze', { block: b.id, on: true, note: words(ctx.pos.slice(1)) || ctx.flags.note || '' })]);
    out(ctx, `Froze ${b.name}. Agents can't reserve it or edit inside it until it's unfrozen.`);
  },
  async unfreeze(ctx) {
    const b = needBlock(ctx, ctx.pos[0]);
    await commit(ctx, [ev(ctx, 'block.freeze', { block: b.id, on: false })]);
    out(ctx, `Unfroze ${b.name}.`);
  },

  async blocks(ctx) {
    const rows = ctx.board.blocks.filter((b) => !ctx.flags.district || b.district === ctx.flags.district);
    const byDistrict = {};
    for (const b of rows) (byDistrict[b.district] ||= []).push(b);
    const lines = [];
    for (const d of ctx.board.districts) {
      if (!byDistrict[d.id]) continue;
      lines.push(d.name);
      for (const b of byDistrict[d.id]) {
        const s = ctx.state.blocks[b.id];
        const tag = s.holder ? `held by ${agentName(ctx.state, s.holder)}` : s.frozen ? 'frozen' : 'free';
        lines.push(`  ${b.id.padEnd(18)} ${b.name.padEnd(32)} ${tag}`);
      }
    }
    out(ctx, lines.join('\n'), rows.map((b) => ({ ...b, state: ctx.state.blocks[b.id] })));
  },

  async agents(ctx) {
    const rows = Object.values(ctx.state.agents).filter((a) => a.id !== HUMAN && !a.leftAt);
    out(
      ctx,
      rows.length ? rows.map((a) => `${a.name.padEnd(10)} ${a.id.padEnd(12)} ${presence(ctx.state, a.id, ctx.now).padEnd(8)} ${a.held.join(', ') || '-'}  ${a.doing || a.task}`).join('\n') : 'No agents on the board.',
      rows,
    );
  },

  async log(ctx) {
    const n = Number(ctx.flags.n || 30);
    const print = (events, state) => {
      for (const e of events) console.log(`${clock(e.ts)}  ${describeEvent(state, e)}`);
    };
    print(ctx.events.slice(-n), ctx.state);
    if (!ctx.flags.follow || ctx.store.kind !== 'local') return;
    let seen = ctx.events.length;
    setInterval(() => {
      const events = ctx.store.readEvents();
      if (events.length > seen) {
        const state = reduce(ctx.board, events);
        print(events.slice(seen), state);
        seen = events.length;
      }
    }, 700);
    await new Promise(() => {});
  },

  async check(ctx) {
    const files = changedFiles(ctx.store.root, { staged: !!ctx.flags.staged, since: typeof ctx.flags.since === 'string' ? ctx.flags.since : null });
    const mine = new Set(ctx.state.agents[ctx.me]?.held || []);
    const outside = [];
    for (const f of files) {
      const id = blockForPath(ctx.state.index, f) || UNMAPPED;
      const b = ctx.state.blocks[id];
      if (mine.has(id)) continue;
      outside.push({ file: f, block: id, holder: b.holder });
    }
    if (!outside.length) return out(ctx, `All ${files.length} changed file${files.length === 1 ? '' : 's'} sit in blocks you hold.`, { ok: true, files });
    const lines = outside.map((o) => `  ${o.file}  →  ${o.block === UNMAPPED ? 'no block' : blockMeta(ctx.state, o.block).name}${o.holder ? ` (held by ${agentName(ctx.state, o.holder)})` : ' (free)'}`);
    out(ctx, `${outside.length} changed file${outside.length === 1 ? '' : 's'} outside your blocks:\n${lines.join('\n')}\nReserve the free ones with \`bm reserve <block>\`; coordinate on the held ones.`, { ok: false, outside });
    process.exitCode = 1;
  },

  async serve(ctx) {
    const { serve } = await import('./server.js');
    await serve({ port: Number(ctx.flags.port || process.env.BLOCKMAP_PORT || 4477), host: ctx.flags.host || '127.0.0.1', open: !!ctx.flags.open, demo: !!ctx.flags.demo });
  },

  async snapshot(ctx) {
    const dir = path.resolve(ctx.flags.out || 'blockmap-snapshot');
    fs.mkdirSync(dir, { recursive: true });
    const board = ctx.store.board({ items: true, files: true, samples: 14 });
    fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify(board));
    fs.writeFileSync(path.join(dir, 'events.json'), JSON.stringify(ctx.flags.empty ? [] : ctx.events));
    out(ctx, `Wrote ${path.join(dir, 'board.json')} and events.json (${ctx.events.length} events).`);
  },

  async hooks(ctx) {
    const { installHooks } = await import('./hooks/install.js');
    const action = ctx.pos[0] || 'print';
    const res = installHooks(ctx.store.root, action);
    out(ctx, res.message, res);
  },

  async init(ctx) {
    const { initBoard } = await import('./scripts/init.js');
    const res = initBoard(process.cwd(), { auto: ctx.flags.auto !== false, name: ctx.flags.name });
    console.log(res.message);
  },

  async help() {
    console.log(HELP);
  },
};

function resolveAgent(ctx, q) {
  const s = String(q || '').toLowerCase();
  const all = Object.values(ctx.state.agents);
  const hit = all.find((a) => a.id.toLowerCase() === s) || all.find((a) => a.name.toLowerCase() === s) || all.find((a) => a.name.toLowerCase().startsWith(s));
  if (!hit) throw new Refusal(`No agent "${q}". \`bm agents\` lists them.`);
  return hit.id;
}

async function fileItem(ctx, kind) {
  const title = words(ctx.pos);
  if (!title) throw new Refusal(`\`bm ${kind === 'question' ? 'ask' : kind} "<title>" [--block <block>]\``);
  const block = ctx.flags.block ? needBlock(ctx, ctx.flags.block).id : defaultBlock(ctx);
  const item = { kind, title, block, detail: typeof ctx.flags.detail === 'string' ? ctx.flags.detail : '' };
  const [e] = await commit(ctx, [...joinIfNeeded(ctx), ev(ctx, 'item.add', { item })]).then((evs) => evs.filter((x) => x.type === 'item.add'));
  const where = block ? ` in ${blockMeta(ctx.state, block).name}` : '';
  const after = kind === 'question' ? ' The human sees it on the board; `bm inbox` shows the answer.' : '';
  out(ctx, `Filed ${e.item.id}${where}.${after}`, e.item);
}

function protocolHint() {
  return 'Reserve a block before you edit in it (`bm reserve <block> --for "<what>"`), say what you are doing (`bm doing "<what>"`), release it when the work lands (`bm release --landed`).';
}

export function summary(state, now, me = null) {
  const agents = Object.values(state.agents).filter((a) => a.id !== HUMAN && !a.leftAt);
  const held = Object.values(state.blocks).filter((b) => b.holder);
  const al = alerts(state, now);
  const lines = [`${state.board.name} board · ${agents.length} agent${agents.length === 1 ? '' : 's'} · ${held.length} of ${state.board.blocks.length} blocks held · ${al.length} alert${al.length === 1 ? '' : 's'}`];
  const human = state.agents[HUMAN];
  if (human.held.length) lines.push(`  ${human.name} (the human) holds ${human.held.join(', ')}: agents stay out`);
  for (const a of agents) {
    const p = presence(state, a.id, now);
    lines.push(`  ${a.name}${a.id === me ? ' (you)' : ''} · ${p} · seen ${ago(now - a.lastSeen)} ago${a.doing ? ` · ${a.doing}` : a.task ? ` · ${a.task}` : ''}`);
    if (a.held.length) lines.push(`      holds ${a.held.map((id) => `${id}${state.blocks[id].intent ? ` ("${state.blocks[id].intent}")` : ''}`).join(', ')}`);
  }
  const q = queue(state);
  if (q.length) lines.push(`Up next: ${q.map((b) => `${b.id}${b.queued.note ? ` ("${b.queued.note}")` : ''}`).join(', ')}  (\`bm next\` takes the first)`);
  const frozen = Object.values(state.blocks).filter((b) => b.frozen);
  if (frozen.length) lines.push(`Frozen: ${frozen.map((b) => `${b.id}${b.frozen.note ? ` (${b.frozen.note})` : ''}`).join(', ')}`);
  for (const a of al.slice(0, 6)) lines.push(`  ! ${a.text}`);
  if (me && me !== HUMAN && state.agents[me]?.inbox.length) lines.push(`You have ${state.agents[me].inbox.length} unread message(s): \`bm inbox\``);
  return lines.join('\n');
}

const HELP = `bm, the Blockmap command line

Board
  bm                         who holds what, the queue, alerts
  bm blocks [--district d]   every block and whether it's free
  bm show <block>            a block's docs, open items and recent activity
  bm which <path...>         which block owns a file, and who holds it
  bm agents | bm log [-n 30] [--follow]
  bm serve [--port 4477] [--open] [--demo]   the visual board in a browser

Working (agents)
  bm join [--name N] [--task T]              join the board (any command joins you)
  bm reserve <block...> [--for "intent"] [--watch] [--force]
  bm next                                    take the top block from the human's queue
  bm doing "<what you're doing now>"
  bm status working|idle|blocked|done
  bm touch <path...> [--op edit|read]        record activity (the hooks do this for you)
  bm test pass|fail "<what ran>" [--block b]
  bm bug|task "<title>" [--block b] [--detail d]
  bm ask "<question for the human>"          shows on the board; the answer lands in your inbox
  bm item <id> open|doing|done|wontfix [--note n]
  bm inbox                                   messages and answers from the human
  bm note "<text>" [--block b]  |  bm msg <agent|all> "<text>"
  bm release [<block...>] [--landed|--parked|--handoff|--dropped] [--note n]
  bm check [--staged | --since <ref>]        changed files outside your blocks (exit 1)
  bm leave

The human
  bm queue <block> ["note"]  |  bm unqueue <block>
  bm freeze <block> ["why"]  |  bm unfreeze <block>
  bm hooks install|uninstall|print           Claude Code hooks, in .claude/settings.local.json
  bm snapshot --out <dir>                    board + log for the standalone page
  bm init [--name N]                         a board for a new repository

Identity: --as <id>, else BLOCKMAP_AGENT, else the Claude Code session, else the human.
Remote board: BLOCKMAP_URL=http://host:4477 (and BLOCKMAP_TOKEN if the server has one).
Add --json to any command for machine-readable output.`;

// ---------------------------------------------------------------------------------------------

async function main() {
  const { cmd, pos, flags } = parse(process.argv.slice(2));
  const fn = commands[cmd];
  if (!fn) {
    console.error(`bm: no command "${cmd}". \`bm help\` lists them.`);
    process.exit(2);
  }
  if (cmd === 'help' || cmd === 'init') return fn({ pos, flags });
  const ctx = await context(flags);
  ctx.pos = pos;
  await fn(ctx);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    if (err instanceof Refusal) {
      console.error(`bm: ${err.message}`);
      process.exit(3);
    }
    console.error(`bm: ${err.message}`);
    process.exit(1);
  });
}

