// A simulated crew for the demo board: agents that join, take real backlog items, reserve their
// blocks, edit real files, run tests, file bugs, ask the human things and land their work.
// Pure: it proposes events from a state and a clock, and every event still passes checkEvent.
// Runs in Node (`bm serve --demo`) and the browser (the standalone page).

import { HUMAN, UNMAPPED, apply, checkEvent, createState, makeEvent, queue } from '../core/model.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CREW = [
  { id: 'cc-7f3a91c2', name: 'Heron', model: 'opus', where: 'dev box, develop', pace: 1 },
  { id: 'cc-2b8e44d0', name: 'Basalt', model: 'opus', where: 'dev box, worktree agent-2', pace: 0.8 },
  { id: 'cc-c41d07aa', name: 'Juniper', model: 'sonnet', where: 'cloud, develop', pace: 1.2 },
  { id: 'cc-91e6b3f5', name: 'Wren', model: 'opus', where: 'dev box, worktree agent-4', pace: 0.7 },
];

const QUESTIONS = [
  'Should this follow Excel here, or keep our answer and note the divergence?',
  'The spec and the code disagree on this case. Which one wins?',
  'This changes what two saved seeds show. Go ahead?',
  'Is a breaking rename fine here, or does a seed depend on the old name?',
  'Two ways to fix it: a small patch now, or the clean change that touches three cards. Which?',
];
const BUGS = [
  'Empty input answers 0 where the spec says blank',
  'Undo after a paste leaves a stale cable',
  'Unit drops off when the column is sorted',
  'Popup scroll jumps after a resize',
  'A date column reads as text after a filter',
  'Error chip shows the wrong card name',
  'Tooltip clips at the right edge on a phone',
];
const PERMISSIONS = ['Claude needs your permission to use Bash', 'Claude needs your permission to edit vite.config.ts', 'Claude needs your permission to run npm install'];
const ANSWERS = ['Follow Excel, and note it in excel-divergences.', 'The spec wins. Fix the code.', 'Go ahead, refreeze the seeds.', 'Clean change. Pre-alpha, break freely.', 'Small patch now, file the clean change as a task.'];

export function createSim(board, { seed = 7, crew = CREW } = {}) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const plans = Object.fromEntries(crew.map((c, i) => [c.id, { ...c, phase: 'offline', wakeAt: 0, budget: 0, item: null, block: null, extra: null, waitingSince: 0, napUntil: 0, order: i }]));
  const blocksById = Object.fromEntries(board.blocks.map((b) => [b.id, b]));
  let humanAt = 0;

  const filesOf = (id) => {
    const b = blocksById[id];
    const list = (b?.sample || []).filter((f) => !/\.(png|jpg|svg|lock|json)$/.test(f));
    return list.length ? list : [`${(b?.paths?.[0] || id).replace(/[{*].*$/, '').replace(/\/$/, '')}/index.ts`];
  };
  const testOf = (id) => {
    const t = (blocksById[id]?.sample || []).find((f) => /\.test\.|tests\//.test(f));
    return t || `tests/graph/${id.replace(/-./g, (m) => m[1].toUpperCase())}.test.ts`;
  };
  const lines = () => ({ add: 1 + Math.floor(rand() ** 2 * 70), del: Math.floor(rand() ** 2 * 35) });
  const short = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

  function emit(state, out, type, by, payload, t) {
    const e = makeEvent(state, type, by, payload, t, rand);
    if (checkEvent(state, e, t)) return null;
    apply(state, e);
    out.push(e);
    return e;
  }

  function chooseWork(state, t) {
    const q = queue(state).filter((b) => !b.holder && !b.frozen);
    if (q.length && rand() < 0.7) return { block: q[0].id, title: q[0].queued.note || `Queued: ${blocksById[q[0].id]?.name}`, item: null };
    const items = Object.values(state.items).filter((it) => it.block && it.status === 'open' && it.kind !== 'decision' && it.kind !== 'question' && !state.blocks[it.block]?.holder && !state.blocks[it.block]?.frozen);
    if (!items.length) return null;
    const it = pick(items);
    return { block: it.block, title: it.title, item: it.id };
  }

  function stepAgent(state, p, t, out) {
    const a = state.agents[p.id];
    if (t < p.wakeAt) return;
    if (p.napFrom && t >= p.napFrom && t < p.napUntil) return;
    if (a?.inbox.length && rand() < 0.5) {
      emit(state, out, 'msg.read', p.id, { ids: a.inbox.map((m) => m.id) }, t);
      return;
    }
    switch (p.phase) {
      case 'offline': {
        emit(state, out, 'agent.join', p.id, { agent: { id: p.id, name: p.name, kind: 'claude-code', model: p.model, where: p.where }, task: '' }, t);
        p.phase = 'idle';
        p.wakeAt = t + 20_000;
        return;
      }
      case 'idle': {
        const work = chooseWork(state, t);
        if (!work) return;
        const r = emit(state, out, 'block.reserve', p.id, { block: work.block, intent: short(work.title) }, t);
        if (!r) return;
        p.block = work.block;
        p.item = work.item;
        p.budget = 4 + Math.floor(rand() * 9);
        p.phase = 'working';
        emit(state, out, 'agent.status', p.id, { status: 'working', task: short(work.title, 90), doing: `Reading ${(blocksById[work.block]?.docs || [])[0] || 'the block'}` }, t + 1);
        if (work.item) emit(state, out, 'item.update', p.id, { item: work.item, status: 'doing' }, t + 2);
        const doc = (blocksById[work.block]?.docs || [])[0];
        if (doc) emit(state, out, 'touch', p.id, { files: [doc], op: 'read' }, t + 3);
        p.wakeAt = t + 30_000 / p.pace;
        return;
      }
      case 'working': {
        if (a?.asked.length) {
          p.wakeAt = t + 20_000;
          return;
        }
        const roll = rand();
        if (roll < 0.05 && !p.extra) {
          const near = board.blocks.filter((b) => b.district === blocksById[p.block]?.district && b.id !== p.block && !state.blocks[b.id].holder && !state.blocks[b.id].frozen);
          if (near.length) {
            const b = pick(near);
            if (emit(state, out, 'block.reserve', p.id, { block: b.id, intent: `touches ${blocksById[p.block]?.name}` }, t)) p.extra = b.id;
          }
        } else if (roll < 0.085) {
          emit(state, out, 'item.add', p.id, { item: { kind: 'bug', title: pick(BUGS), block: p.block, detail: 'Found while working nearby.' } }, t);
        } else if (roll < 0.105 && !Object.values(state.items).some((it) => it.kind === 'question' && it.status === 'open')) {
          emit(state, out, 'item.add', p.id, { item: { kind: 'question', title: pick(QUESTIONS), block: p.block } }, t);
          p.waitingSince = t;
        } else if (roll < 0.118) {
          const held = Object.values(state.blocks).filter((b) => b.holder && b.holder !== p.id && b.holder !== HUMAN);
          if (held.length) {
            const b = pick(held);
            emit(state, out, 'touch', p.id, { files: [pick(filesOf(b.id))], op: 'edit', ...lines() }, t);
          }
        } else if (roll < 0.13) {
          emit(state, out, 'agent.status', p.id, { status: 'waiting', doing: pick(PERMISSIONS) }, t);
          p.phase = 'permission';
          p.wakeAt = t + (60_000 + rand() * 120_000) / p.pace;
          return;
        } else {
          const target = p.extra && rand() < 0.3 ? p.extra : p.block;
          const file = pick(filesOf(target));
          emit(state, out, 'touch', p.id, { files: [file], op: 'edit', ...lines() }, t);
          if (rand() < 0.45) emit(state, out, 'agent.status', p.id, { doing: `Editing ${file}` }, t + 1);
          p.budget--;
        }
        if (p.budget <= 0) p.phase = 'testing';
        p.wakeAt = t + (18_000 + rand() * 40_000) / p.pace;
        return;
      }
      case 'permission': {
        emit(state, out, 'agent.status', p.id, { status: 'working', doing: 'Allowed, carrying on' }, t);
        p.phase = 'working';
        p.wakeAt = t + 15_000 / p.pace;
        return;
      }
      case 'testing': {
        const test = testOf(p.block);
        emit(state, out, 'touch', p.id, { op: 'run', cmd: `npx vitest run ${test}` }, t);
        const ok = rand() < 0.78;
        emit(state, out, 'test', p.id, { ok, summary: ok ? `${8 + Math.floor(rand() * 60)} passed in ${test.split('/').pop()}` : `1 failed in ${test.split('/').pop()}`, blocks: [p.block, p.extra].filter(Boolean) }, t + 1);
        if (ok) p.phase = 'landing';
        else {
          p.phase = 'working';
          p.budget = 2 + Math.floor(rand() * 3);
          emit(state, out, 'agent.status', p.id, { doing: 'Fixing the failing test' }, t + 2);
        }
        p.wakeAt = t + 25_000 / p.pace;
        return;
      }
      case 'landing': {
        for (const id of [p.block, p.extra].filter(Boolean)) emit(state, out, 'block.release', p.id, { block: id, outcome: 'landed', note: '' }, t);
        if (p.item && state.items[p.item]) emit(state, out, 'item.update', p.id, { item: p.item, status: 'done' }, t + 1);
        emit(state, out, 'agent.status', p.id, { status: 'review', doing: `Committed: ${short(a?.task || 'the change', 60)}` }, t + 2);
        p.block = p.item = p.extra = null;
        p.phase = 'idle';
        p.wakeAt = t + (60_000 + rand() * 120_000) / p.pace;
        return;
      }
      default:
    }
  }

  function stepHuman(state, t, out) {
    if (t < humanAt) return;
    humanAt = t + 60_000 + rand() * 180_000;
    const open = Object.values(state.items).filter((it) => it.kind === 'question' && it.status === 'open' && t - it.createdAt > 150_000);
    if (open.length) {
      const q = open[0];
      emit(state, out, 'item.update', HUMAN, { item: q.id, status: 'done', answer: pick(ANSWERS) }, t);
      return;
    }
    if (queue(state).length < 2 && rand() < 0.5) {
      const items = Object.values(state.items).filter((it) => it.block && it.status === 'open' && !state.blocks[it.block].holder && !state.blocks[it.block].queued && !state.blocks[it.block].frozen && it.kind !== 'decision');
      if (items.length) {
        const it = pick(items);
        emit(state, out, 'block.queue', HUMAN, { block: it.block, note: short(it.title, 80) }, t);
      }
    }
  }

  return {
    crew,
    // Advance the crew one beat at time t.
    step(state, t) {
      const out = [];
      for (const p of Object.values(plans)) if (rand() < 0.55) stepAgent(state, p, t + p.order * 7, out);
      stepHuman(state, t, out);
      return out;
    },
    // A plausible past: the last hours of a working session, ending at `to`.
    history(from, to, base = createState(board)) {
      const state = base;
      const out = [];
      const put = (type, by, payload, t) => {
        const e = makeEvent(state, type, by, payload, t, rand);
        if (!checkEvent(state, e, t)) {
          apply(state, e);
          out.push(e);
        }
      };
      const span = to - from;
      const has = (id) => !!blocksById[id];
      if (has('release')) put('block.freeze', HUMAN, { block: 'release', on: true, note: '1.6.2 notes are with the author' }, from + span * 0.05);
      crew.forEach((c, i) => {
        plans[c.id].wakeAt = from + span * (0.02 + i * 0.12);
      });
      // The last of the crew goes quiet mid-task 45 minutes before the end, so the board opens
      // with a stale holder, and wakes a few minutes after.
      const napper = plans[crew[crew.length - 1].id];
      const napFrom = to - 45 * 60_000;
      let t = from;
      while (t < to) {
        if (t >= napFrom && !napper.napFrom) {
          if (!state.agents[napper.id]?.held.length) {
            napper.phase = 'idle';
            napper.wakeAt = 0;
            stepAgent(state, napper, t, out);
          }
          napper.napFrom = napFrom;
          napper.napUntil = to + 3 * 60_000;
        }
        for (const p of Object.values(plans)) if (rand() < 0.6) stepAgent(state, p, t, out);
        stepHuman(state, t, out);
        t += 12_000 + rand() * 14_000;
      }
      let last = 0;
      for (const e of out) {
        e.ts = Math.max(e.ts, last + 1);
        last = e.ts;
      }
      return out;
    },
  };
}

export { UNMAPPED };
