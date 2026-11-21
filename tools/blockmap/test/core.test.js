// The core: path matching, the fold, the reservation rules, the importer and the store's lock.
// `node --test tools/blockmap/test/`

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expandBraces, compileIndex, blockForPath } from '../core/glob.js';
import { HUMAN, reduce, apply, createState, makeEvent, checkEvent, alerts, presence, needsHuman, isStale, findBlock, itemCounts } from '../core/model.js';
import { lineCounts } from '../hooks/lines.js';
import { importChecklist } from '../adapters/markdown-checklist.js';
import { openStore } from '../core/store.js';
import { draftBoard } from '../scripts/init.js';
import { createSim } from '../ui/sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const BOARD = {
  name: 'Test',
  staleAfterMin: 30,
  districts: [{ id: 'd', name: 'D' }],
  blocks: [
    { id: 'engine', name: 'Engine', district: 'd', paths: ['src/engine/', 'src/{pass,session}.ts'], keywords: ['compute'] },
    { id: 'pass', name: 'The pass', district: 'd', paths: ['src/engine/pass.ts'], keywords: ['pass'] },
    { id: 'tables', name: 'Tables', district: 'd', paths: ['src/**/*table*', 'README.md'], keywords: ['table', 'pivot'] },
  ],
  items: [],
};

let clock = 1_000_000;
const at = (min) => clock + min * 60_000;
function ev(state, type, by, payload, min) {
  const e = makeEvent(state, type, by, payload, at(min));
  return { e, why: checkEvent(state, e, at(min)) };
}
function run(state, type, by, payload, min) {
  const { e, why } = ev(state, type, by, payload, min);
  assert.equal(why, null, `${type} refused: ${why}`);
  apply(state, e);
  return e;
}

test('braces expand into separate patterns', () => {
  assert.deepEqual(expandBraces('a/{b,c}/{d,e}.ts'), ['a/b/d.ts', 'a/b/e.ts', 'a/c/d.ts', 'a/c/e.ts']);
  assert.deepEqual(expandBraces('x/{a,{b,c}}'), ['x/a', 'x/b', 'x/c']);
});

test('the most specific pattern claims a path', () => {
  const index = compileIndex(BOARD.blocks);
  assert.equal(blockForPath(index, 'src/engine/pass.ts'), 'pass');
  assert.equal(blockForPath(index, 'src/engine/dataflow.ts'), 'engine');
  assert.equal(blockForPath(index, 'src/session.ts'), 'engine');
  assert.equal(blockForPath(index, 'src/ui/TablePopup.tsx'), 'tables');
  assert.equal(blockForPath(index, './README.md'), 'tables');
  assert.equal(blockForPath(index, 'docs/other.md'), null);
});

test('a reservation refuses a second agent until the holder goes quiet', () => {
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1', name: 'Heron' } }, 0);
  run(st, 'agent.join', 'a2', { agent: { id: 'a2', name: 'Basalt' } }, 0);
  run(st, 'block.reserve', 'a1', { block: 'engine', intent: 'fix the pass' }, 1);
  assert.equal(st.blocks.engine.holder, 'a1');
  assert.deepEqual(st.agents.a1.held, ['engine']);
  assert.match(ev(st, 'block.reserve', 'a2', { block: 'engine' }, 2).why, /held by Heron/);
  assert.match(ev(st, 'block.release', 'a2', { block: 'engine' }, 2).why, /not you/);
  // Forty minutes of silence from Heron: Basalt may take over, and the history says so.
  const late = ev(st, 'block.reserve', 'a2', { block: 'engine' }, 45);
  assert.equal(late.why, null);
  apply(st, late.e);
  assert.equal(st.blocks.engine.holder, 'a2');
  assert.equal(st.blocks.engine.history.at(-1).outcome, 'taken');
  assert.deepEqual(st.agents.a1.held, []);
});

test('the human can give, take back and freeze blocks; agents respect it', () => {
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1' } }, 0);
  run(st, 'block.reserve', HUMAN, { block: 'tables', agent: 'a1' }, 1);
  assert.equal(st.blocks.tables.holder, 'a1');
  run(st, 'block.release', HUMAN, { block: 'tables', agent: 'a1', outcome: 'parked' }, 2);
  assert.equal(st.blocks.tables.holder, null);
  run(st, 'block.reserve', HUMAN, { block: 'tables' }, 3);
  assert.match(ev(st, 'block.reserve', 'a1', { block: 'tables' }, 4).why, /the human/);
  run(st, 'block.release', HUMAN, { block: 'tables' }, 5);
  run(st, 'block.freeze', HUMAN, { block: 'tables', on: true, note: 'release prep' }, 6);
  assert.match(ev(st, 'block.reserve', 'a1', { block: 'tables' }, 7).why, /frozen \(release prep\)/);
  run(st, 'block.freeze', HUMAN, { block: 'tables', on: false }, 8);
  run(st, 'block.reserve', 'a1', { block: 'tables' }, 9);
});

test('editing inside another agent\'s block raises a trespass alert', () => {
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1', name: 'Heron' } }, 0);
  run(st, 'agent.join', 'a2', { agent: { id: 'a2', name: 'Basalt' } }, 0);
  run(st, 'block.reserve', 'a1', { block: 'pass' }, 1);
  run(st, 'touch', 'a2', { files: ['src/engine/pass.ts'], op: 'edit' }, 2);
  const al = alerts(st, at(3));
  assert.equal(al[0].kind, 'trespass');
  assert.match(al[0].text, /Basalt edited pass\.ts in Heron's The pass/);
  assert.equal(st.blocks.pass.touches.length, 1);
});

test('a question makes its agent wait; the answer lands in its inbox', () => {
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1' } }, 0);
  const q = run(st, 'item.add', 'a1', { item: { kind: 'question', title: 'Excel or ours?', block: 'engine' } }, 1);
  assert.equal(q.item.id, 'Q1');
  assert.equal(presence(st, 'a1', at(2)), 'waiting');
  run(st, 'item.update', HUMAN, { item: 'Q1', answer: 'Follow Excel.' }, 3);
  assert.equal(st.items.Q1.status, 'done');
  assert.equal(presence(st, 'a1', at(3)), 'working');
  assert.match(st.agents.a1.inbox[0].text, /Follow Excel/);
  run(st, 'msg.read', 'a1', { ids: st.agents.a1.inbox.map((m) => m.id) }, 4);
  assert.equal(st.agents.a1.inbox.length, 0);
  const bug = run(st, 'item.add', 'a1', { item: { kind: 'bug', title: 'x', block: 'engine' } }, 5);
  assert.equal(bug.item.id, 'B1');
  assert.equal(itemCounts(st, 'engine').bug, 1);
});

test('leaving releases everything; replay folds to any moment', () => {
  const events = [];
  const st = createState(BOARD);
  events.push(run(st, 'agent.join', 'a1', { agent: { id: 'a1' } }, 0));
  events.push(run(st, 'block.reserve', 'a1', { block: 'engine' }, 1));
  events.push(run(st, 'block.reserve', 'a1', { block: 'tables' }, 2));
  events.push(run(st, 'agent.leave', 'a1', {}, 3));
  assert.equal(st.blocks.engine.holder, null);
  assert.equal(st.blocks.tables.history[0].outcome, 'parked');
  const past = reduce(BOARD, events, at(2));
  assert.deepEqual(past.agents.a1.held, ['engine', 'tables']);
});

test('findBlock takes ids, names and close misses', () => {
  const st = createState(BOARD);
  assert.equal(findBlock(st, 'Tables').block.id, 'tables');
  assert.equal(findBlock(st, 'pivot').block.id, 'tables');
  assert.match(findBlock(st, 'engin').error ?? '', /^$/);
  assert.match(findBlock(st, 'tablez').error, /Closest: tables/);
});

test('the checklist importer keeps titles, kinds, routes and stable ids', () => {
  const md = [
    '# Backlog',
    '## Tables (author)',
    '- [ ] **Pivot drops the year** when grouping by quarter.',
    '- [ ] A plain item about the compute pass; it has no bold title',
    '## From the audit (each needs the author\'s call)',
    '- [ ] **Should a blank table read as zero?** It changes the pass.',
    '- plain bullets are notes, not items',
  ].join('\n');
  const src = { file: 'backlog.md', prefix: 'BL', route: { Tables: 'tables', "needs the author's call": 'auto' }, kinds: [{ match: "needs the author's call", kind: 'decision' }] };
  const items = importChecklist(md, src, BOARD);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Pivot drops the year');
  assert.equal(items[0].block, 'tables');
  assert.equal(items[1].title, 'A plain item about the compute pass');
  assert.equal(items[2].kind, 'decision');
  assert.equal(items[2].block, 'tables');
  assert.equal(importChecklist(md, src, BOARD)[0].id, items[0].id);
  assert.match(items[0].id, /^BL-/);
});

test('the store refuses the second of two racing reservations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockmap-test-'));
  fs.mkdirSync(path.join(dir, '.blockmap'));
  fs.writeFileSync(path.join(dir, '.blockmap', 'board.json'), JSON.stringify(BOARD));
  const prev = process.env.BLOCKMAP_LIVE;
  delete process.env.BLOCKMAP_LIVE;
  try {
    const store = openStore(path.join(dir, '.blockmap'));
    const snapshot = store.state();
    const a = makeEvent(snapshot, 'block.reserve', 'a1', { block: 'engine' });
    const b = makeEvent(snapshot, 'block.reserve', 'a2', { block: 'engine' });
    store.commit([a]);
    assert.throws(() => store.commit([b]), /held by/);
    assert.equal(store.readEvents().length, 1);
    assert.equal(store.state().blocks.engine.holder, 'a1');
  } finally {
    if (prev) process.env.BLOCKMAP_LIVE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the hook refuses an edit inside another agent\'s block and reserves a free one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockmap-hook-'));
  fs.mkdirSync(path.join(dir, '.blockmap'));
  fs.writeFileSync(path.join(dir, '.blockmap', 'board.json'), JSON.stringify(BOARD));
  const hook = path.join(HERE, '..', 'hooks', 'claude-code.js');
  const env = { ...process.env, BLOCKMAP_LIVE: path.join(dir, '.blockmap', 'live'), BLOCKMAP_AGENT: '' };
  delete env.BLOCKMAP_AGENT;
  const call = (payload) => execFileSync('node', [hook], { input: JSON.stringify({ cwd: dir, ...payload }), env, encoding: 'utf8' });
  try {
    call({ hook_event_name: 'SessionStart', session_id: 'aaaa0000' });
    const reserve = call({ hook_event_name: 'PreToolUse', session_id: 'aaaa0000', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/engine/pass.ts') } });
    assert.equal(reserve, '');
    const after = call({ hook_event_name: 'PostToolUse', session_id: 'aaaa0000', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/engine/pass.ts') } });
    assert.match(JSON.parse(after).hookSpecificOutput.additionalContext, /reserved The pass/);
    const denied = JSON.parse(call({ hook_event_name: 'PreToolUse', session_id: 'bbbb0000', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/engine/pass.ts') } }));
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(denied.hookSpecificOutput.permissionDecisionReason, /held by/);
    const broken = execFileSync('node', [hook], { input: '{not json', env, encoding: 'utf8' });
    assert.equal(broken, '');
    call({ hook_event_name: 'Notification', session_id: 'aaaa0000', message: 'Claude needs your permission to use Bash' });
    const store = openStore(path.join(dir, '.blockmap'));
    let st = store.state();
    assert.equal(st.agents['cc-aaaa0000'].status, 'waiting');
    assert.equal(st.agents['cc-aaaa0000'].doing, 'Claude needs your permission to use Bash');
    call({ hook_event_name: 'Stop', session_id: 'aaaa0000' });
    st = store.state();
    assert.equal(st.agents['cc-aaaa0000'].status, 'review');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bm init drafts districts and splits big folders', () => {
  const files = [...Array.from({ length: 120 }, (_, i) => `src/a/f${i}.ts`), ...Array.from({ length: 30 }, (_, i) => `src/b/g${i}.ts`), 'src/index.ts', 'README.md', 'docs/x.md'];
  const board = draftBoard(files, 'demo');
  assert.deepEqual(board.districts.map((d) => d.id).sort(), ['docs', 'root', 'src']);
  const ids = board.blocks.map((b) => b.id);
  assert.ok(ids.includes('src-a') && ids.includes('src-b') && ids.includes('src-files'), ids.join(','));
  const index = compileIndex(board.blocks);
  for (const f of files) assert.ok(blockForPath(index, f), `${f} is unclaimed`);
});

test('the simulated crew only ever proposes events the rules accept', () => {
  const board = { ...BOARD, items: [{ id: 'L-1', kind: 'task', title: 'Fix the pass', block: 'engine', status: 'open' }, { id: 'L-2', kind: 'bug', title: 'Pivot', block: 'tables', status: 'open' }] };
  const sim = createSim(board, { seed: 3 });
  const end = at(240);
  const events = sim.history(at(0), end);
  assert.ok(events.length > 50);
  const st = createState(board);
  for (const e of events) {
    assert.equal(checkEvent(st, e, e.ts), null, `${e.type} at ${e.ts}`);
    apply(st, e);
  }
  for (let i = 1; i < events.length; i++) assert.ok(events[i].ts > events[i - 1].ts);
});

test('an agent waiting on the human keeps its blocks four times as long', () => {
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1', name: 'Heron' } }, 0);
  run(st, 'block.reserve', 'a1', { block: 'engine' }, 1);
  run(st, 'agent.status', 'a1', { status: 'review', doing: 'Finished the turn' }, 2);
  assert.equal(needsHuman(st, 'a1', at(3)), true);
  assert.equal(isStale(st, 'a1', at(60)), false);
  assert.match(ev(st, 'block.reserve', 'a2', { block: 'engine' }, 60).why, /held by Heron/);
  assert.equal(isStale(st, 'a1', at(125)), true);
  run(st, 'agent.status', 'a1', { status: 'working' }, 126);
  assert.equal(needsHuman(st, 'a1', at(127)), false);
});

test('edits carry the lines they added and removed', () => {
  assert.deepEqual(lineCounts('Edit', { old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' }), { add: 2, del: 1 });
  assert.deepEqual(lineCounts('Write', { content: 'x\ny\nz' }), { add: 3, del: 0 });
  assert.deepEqual(lineCounts('Edit', {}, { structuredPatch: [{ lines: [' a', '-b', '+B', '+d'] }] }), { add: 2, del: 1 });
  const st = createState(BOARD);
  run(st, 'touch', 'a1', { files: ['src/engine/pass.ts'], op: 'edit', add: 12, del: 4 }, 1);
  run(st, 'touch', 'a1', { files: ['src/engine/x.ts'], op: 'edit', add: 3, del: 0 }, 2);
  assert.equal(st.agents.a1.added, 15);
  assert.equal(st.blocks.pass.added, 12);
  assert.equal(st.blocks.engine.removed, 0);
});

test('worktrees are read from git: conflicts, uncommitted work, identity', async () => {
  const { worktreeSnapshot } = await import('../core/worktrees.js');
  const { whoAmI } = await import('../core/identity.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockmap-wt-'));
  const repo = path.join(dir, 'repo');
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  try {
    fs.mkdirSync(repo);
    sh(repo, 'init', '-q', '-b', 'main');
    sh(repo, 'config', 'user.email', 't@t');
    sh(repo, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    sh(repo, 'add', '.');
    sh(repo, 'commit', '-qm', 'init');
    sh(repo, 'worktree', 'add', '-q', '-b', 'agent-a', path.join(dir, 'agent-a'));
    fs.writeFileSync(path.join(dir, 'agent-a', 'a.txt'), 'one\nTWO A\nthree\n');
    sh(path.join(dir, 'agent-a'), 'commit', '-qam', 'a');
    fs.writeFileSync(path.join(dir, 'agent-a', 'new.txt'), 'x\n');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nTWO MAIN\nthree\n');
    sh(repo, 'commit', '-qam', 'main');
    const snap = await worktreeSnapshot(repo);
    assert.equal(snap.base, 'main');
    const a = snap.list.find((w) => w.name === 'agent-a');
    assert.deepEqual([a.ahead, a.behind, a.dirty], [1, 1, 1]);
    assert.deepEqual(a.files.sort(), ['a.txt', 'new.txt']);
    assert.deepEqual(a.conflicts, ['a.txt']);
    const prev = { ...process.env };
    delete process.env.BLOCKMAP_AGENT;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    delete process.env.CLAUDE_SESSION_ID;
    try {
      assert.equal(whoAmI(undefined, path.join(dir, 'agent-a')), 'wt-agent-a');
      assert.equal(whoAmI(undefined, repo), HUMAN);
    } finally {
      Object.assign(process.env, prev);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the merge queue checks conflicts, overlaps with branches ahead, and moves since ready', async () => {
  const { mergeChecks } = await import('../core/merges.js');
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1', name: 'Heron', worktree: '/w/one' } }, 0);
  run(st, 'agent.join', 'a2', { agent: { id: 'a2', name: 'Basalt', worktree: '/w/two' } }, 0);
  run(st, 'test', 'a1', { ok: true, summary: 'ok' }, 1);
  run(st, 'test', 'a2', { ok: true, summary: 'ok' }, 1);
  run(st, 'merge.ready', 'a1', { worktree: 'one', branch: 'one', commit: 'aaa' }, 2);
  run(st, 'merge.ready', 'a2', { worktree: 'two', branch: 'two', commit: 'bbb' }, 3);
  const snap = {
    base: 'main',
    list: [
      { name: 'one', path: '/w/one', head: 'aaa111', ahead: 2, behind: 0, dirty: 0, files: ['src/engine/pass.ts'], conflicts: [] },
      { name: 'two', path: '/w/two', head: 'ccc', ahead: 1, behind: 3, dirty: 0, files: ['src/engine/pass.ts', 'README.md'], conflicts: [] },
    ],
  };
  const [first, second] = mergeChecks(st, snap, at(4));
  assert.equal(first.verdict, 'Clean');
  assert.equal(second.level, 'warn');
  assert.deepEqual(second.checks.map((c) => c.text).sort(), ['3 behind main', 'Moved since ready', 'Overlaps one']);
  snap.list[1].conflicts = ['README.md'];
  assert.equal(mergeChecks(st, snap, at(4))[1].verdict, 'Conflicts with main');
  run(st, 'merge.order', HUMAN, { worktree: 'two', pos: 0.5 }, 5);
  assert.equal(mergeChecks(st, snap, at(5))[0].entry.worktree, 'two');
  apply(st, makeEvent(st, 'merge.landed', 'system', { worktree: 'two' }, at(6)));
  assert.equal(st.merges.two.status, 'landed');
  assert.equal(st.agents.system, undefined);
});
