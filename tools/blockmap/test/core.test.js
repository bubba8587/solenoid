// The core: path matching, the fold, the reservation rules, the importer and the store's lock.
// `node --test tools/blockmap/test/`

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expandBraces, compileIndex, blockForPath } from '../core/glob.js';
import { HUMAN, reduce, apply, createState, makeEvent, checkEvent, alerts, presence, needsHuman, isStale, findBlock, itemCounts } from '../core/model.js';
import { lineCounts, testVerdict } from '../hooks/lines.js';
import { importChecklist } from '../adapters/markdown-checklist.js';
import { openStore, findBoardDir } from '../core/store.js';
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

// A board in a fresh folder, outside any git checkout, with its own live log.
function tmpBoard(board = BOARD) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockmap-test-'));
  fs.mkdirSync(path.join(dir, '.blockmap'));
  fs.writeFileSync(path.join(dir, '.blockmap', 'board.json'), JSON.stringify(board));
  return { dir, boardDir: path.join(dir, '.blockmap'), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const HOOK = path.join(HERE, '..', 'hooks', 'claude-code.js');
function hookEnv(dir) {
  const env = { ...process.env, BLOCKMAP_LIVE: path.join(dir, '.blockmap', 'live') };
  delete env.BLOCKMAP_AGENT;
  delete env.BLOCKMAP_DIR;
  return env;
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
  // Lines match one to one, so repeated lines never make a count negative.
  assert.deepEqual(lineCounts('Edit', { old_string: '}\n}\n}\n}', new_string: '}' }), { add: 0, del: 3 });
  assert.deepEqual(lineCounts('Edit', { old_string: '}', new_string: '}\n}\n}' }), { add: 2, del: 0 });
  assert.deepEqual(lineCounts('MultiEdit', { edits: [{ old_string: 'x\nx', new_string: 'x' }, { old_string: '', new_string: 'y' }] }), { add: 1, del: 1 });
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
    // Paths come back as written, accents and spaces included, renames under their new name.
    const agentA = path.join(dir, 'agent-a');
    fs.writeFileSync(path.join(agentA, 'données à voir.txt'), 'y\n');
    sh(agentA, 'mv', 'a.txt', 'é.txt');
    const moved = (await worktreeSnapshot(repo)).list.find((w) => w.name === 'agent-a');
    assert.deepEqual(moved.files.sort(), ['données à voir.txt', 'new.txt', 'é.txt']);
    assert.equal(moved.dirty, 3);
    sh(agentA, 'mv', 'é.txt', 'a.txt');
    fs.rmSync(path.join(agentA, 'données à voir.txt'));
    // A linked worktree folds the log over the main checkout's board, even when its branch has its own copy.
    fs.mkdirSync(path.join(repo, '.blockmap'));
    fs.writeFileSync(path.join(repo, '.blockmap', 'board.json'), JSON.stringify({ ...BOARD, blocks: [...BOARD.blocks, { id: 'mainonly', name: 'Main only', district: 'd', paths: ['m/'] }] }));
    fs.mkdirSync(path.join(agentA, '.blockmap'));
    fs.writeFileSync(path.join(agentA, '.blockmap', 'board.json'), JSON.stringify(BOARD));
    assert.equal(findBoardDir(agentA), path.join(repo, '.blockmap'));
    const prevLive = process.env.BLOCKMAP_LIVE;
    const prevDir = process.env.BLOCKMAP_DIR;
    delete process.env.BLOCKMAP_LIVE;
    delete process.env.BLOCKMAP_DIR;
    try {
      const wtStore = openStore(findBoardDir(agentA), { cwd: path.join(agentA, 'src') });
      assert.equal(wtStore.root, agentA);
      assert.equal(wtStore.home, repo);
      assert.equal(wtStore.live, path.join(repo, '.blockmap', 'live'));
      assert.ok(wtStore.state().blocks.mainonly);
      // `bm ready` refuses a branch with nothing committed ahead of the base.
      sh(repo, 'worktree', 'add', '-q', '-b', 'agent-b', path.join(dir, 'agent-b'));
      const env = { ...process.env };
      for (const k of ['BLOCKMAP_AGENT', 'BLOCKMAP_URL', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID']) delete env[k];
      const ready = spawnSync(process.execPath, [path.join(HERE, '..', 'cli.js'), 'ready'], { cwd: path.join(dir, 'agent-b'), env, encoding: 'utf8' });
      assert.equal(ready.status, 3, ready.stderr);
      assert.match(ready.stderr, /Nothing to merge: agent-b has no commits ahead of main/);
      const queued = spawnSync(process.execPath, [path.join(HERE, '..', 'cli.js'), 'ready'], { cwd: agentA, env, encoding: 'utf8' });
      assert.equal(queued.status, 0, queued.stderr);
      assert.equal(wtStore.state().merges['agent-a'].ahead, 1);
    } finally {
      if (prevLive !== undefined) process.env.BLOCKMAP_LIVE = prevLive;
      if (prevDir !== undefined) process.env.BLOCKMAP_DIR = prevDir;
    }
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
  assert.equal(first.verdict, 'Ready');
  assert.equal(first.level, 'ok');
  // Sharing a file with a branch ahead is worth knowing, not a warning; being behind and moving since ready are.
  assert.equal(second.level, 'warn');
  assert.deepEqual(second.checks.map((c) => c.text).sort(), ['3 behind main', 'Moved since ready', 'Shares files with Heron']);
  assert.equal(second.checks.find((c) => c.text === 'Shares files with Heron').level, 'info');
  // A conflict the merge forecast finds between the two branches is danger.
  const clashing = mergeChecks(st, { ...snap, clashes: [{ a: 'one', b: 'two', files: ['src/engine/pass.ts'] }] }, at(4))[1];
  assert.equal(clashing.level, 'danger');
  assert.equal(clashing.verdict, 'Conflicts with Heron');
  snap.list[1].conflicts = ['README.md'];
  assert.equal(mergeChecks(st, snap, at(4))[1].verdict, 'Conflicts with main');
  run(st, 'merge.order', HUMAN, { worktree: 'two', pos: 0.5 }, 5);
  assert.equal(mergeChecks(st, snap, at(5))[0].entry.worktree, 'two');
  apply(st, makeEvent(st, 'merge.landed', 'system', { worktree: 'two' }, at(6)));
  assert.equal(st.merges.two.status, 'landed');
  assert.equal(st.agents.system, undefined);
});

test('a torn last line does not swallow the next event', () => {
  const t = tmpBoard();
  try {
    const store = openStore(t.boardDir);
    store.commit([makeEvent(store.state(), 'agent.join', 'a1', { agent: { id: 'a1' } })]);
    // A writer crashed halfway through its line.
    fs.appendFileSync(store.eventsPath, '{"id":"x","ts":1,"by":"a2","type":"block.res');
    store.commit([makeEvent(store.state(), 'block.reserve', 'a1', { block: 'engine' })]);
    const fresh = openStore(t.boardDir);
    assert.equal(fresh.state().blocks.engine.holder, 'a1');
    assert.deepEqual(fresh.readEvents().map((e) => e.type), ['agent.join', 'block.reserve']);
  } finally {
    t.done();
  }
});

test('the kept fold follows appends from elsewhere and starts over when the log is replaced', () => {
  const t = tmpBoard();
  try {
    const store = openStore(t.boardDir);
    store.commit([makeEvent(store.state(), 'agent.join', 'a1', { agent: { id: 'a1' } })]);
    const other = makeEvent(store.state(), 'block.reserve', 'a1', { block: 'engine' });
    fs.appendFileSync(store.eventsPath, `${JSON.stringify(other)}\n`);
    assert.equal(store.state().blocks.engine.holder, 'a1');
    // A longer log with other contents: the fold notices and folds it from the start.
    const lines = [makeEvent(store.state(), 'agent.join', 'a2', { agent: { id: 'a2' } }), makeEvent(store.state(), 'block.reserve', 'a2', { block: 'tables' }), makeEvent(store.state(), 'note', 'a2', { text: 'x'.repeat(200) })];
    fs.writeFileSync(store.eventsPath, lines.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const st = store.state();
    assert.equal(st.agents.a1, undefined);
    assert.equal(st.blocks.tables.holder, 'a2');
    assert.equal(st.blocks.engine.holder, null);
  } finally {
    t.done();
  }
});

test('the lock is broken only when its holder is gone, and only its owner removes it', () => {
  const t = tmpBoard();
  try {
    const store = openStore(t.boardDir, { lockWaitMs: 300 });
    const join = () => makeEvent(store.state(), 'agent.join', 'a1', { agent: { id: 'a1' } });
    fs.mkdirSync(store.live, { recursive: true });
    const lock = (pid, nonce) => fs.writeFileSync(store.lockPath, JSON.stringify({ pid, host: os.hostname(), nonce, ts: Date.now() }));
    // A running holder keeps its lock, however long it has had it (up to a minute): the writer waits, then gives up.
    lock(process.pid, 'live');
    const old = new Date(Date.now() - 20_000);
    fs.utimesSync(store.lockPath, old, old);
    assert.throws(() => store.commit([join()]), /locked/);
    assert.equal(JSON.parse(fs.readFileSync(store.lockPath, 'utf8')).nonce, 'live');
    // A holder that died is taken over at once.
    lock(spawnSync(process.execPath, ['-e', '']).pid, 'dead');
    const t0 = Date.now();
    store.commit([join()]);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(fs.existsSync(store.lockPath), false);
    // A lock someone else holds by the time this writer finishes is theirs to remove.
    store.withLock(() => lock(process.pid, 'theirs'));
    assert.equal(JSON.parse(fs.readFileSync(store.lockPath, 'utf8')).nonce, 'theirs');
  } finally {
    t.done();
  }
});

test('the hook denies the agent that loses a reservation race, and a freeze stops the holder too', async () => {
  const t = tmpBoard();
  const env = hookEnv(t.dir);
  const call = (payload) => execFileSync('node', [HOOK], { input: JSON.stringify({ cwd: t.dir, ...payload }), env, encoding: 'utf8' });
  try {
    call({ hook_event_name: 'SessionStart', session_id: 'bbbb0000' });
    const store = openStore(t.boardDir);
    store.commit([makeEvent(store.state(), 'agent.join', 'a1', { agent: { id: 'a1', name: 'Heron' } })]);
    // Hold the lock, so the hook reads a free block and then waits to reserve it while Heron takes it.
    fs.writeFileSync(store.lockPath, JSON.stringify({ pid: process.pid, host: os.hostname(), nonce: 'test', ts: Date.now() }));
    const child = spawn('node', [HOOK], { env });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    const exited = new Promise((resolve) => child.on('close', resolve));
    child.stdin.end(JSON.stringify({ cwd: t.dir, hook_event_name: 'PreToolUse', session_id: 'bbbb0000', tool_name: 'Edit', tool_input: { file_path: path.join(t.dir, 'src/engine/pass.ts') } }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    fs.appendFileSync(store.eventsPath, `${JSON.stringify(makeEvent(store.state(), 'block.reserve', 'a1', { block: 'pass' }))}\n`);
    fs.rmSync(store.lockPath);
    await exited;
    const lost = JSON.parse(out).hookSpecificOutput;
    assert.equal(lost.permissionDecision, 'deny');
    assert.match(lost.permissionDecisionReason, /taken before Blockmap could reserve it for you\. The pass is held by Heron/);
    assert.equal(store.state().blocks.pass.holder, 'a1');
    // Heron edits its own block freely, until the human freezes it.
    env.BLOCKMAP_AGENT = 'a1';
    assert.equal(call({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(t.dir, 'src/engine/pass.ts') } }), '');
    store.commit([makeEvent(store.state(), 'block.freeze', HUMAN, { block: 'pass', on: true, note: 'release prep' })]);
    const frozen = JSON.parse(call({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(t.dir, 'src/engine/pass.ts') } })).hookSpecificOutput;
    assert.equal(frozen.permissionDecision, 'deny');
    assert.match(frozen.permissionDecisionReason, /froze \(release prep\)/);
  } finally {
    t.done();
  }
});

test('a test run passes only if every result line does', () => {
  const cargo = (...results) => results.map((r) => `running 3 tests\ntest a ... ok\n\ntest result: ${r}; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n`).join('\n');
  const multi = `${cargo('ok. 3 passed; 0 failed', 'FAILED. 1 passed; 2 failed')}\nerror: test failed, to rerun pass \`--test nodes\``;
  assert.deepEqual(testVerdict({ stdout: multi }), { ok: false, summary: '2 failed, 4 passed' });
  assert.deepEqual(testVerdict({ stdout: cargo('ok. 3 passed; 0 failed', 'ok. 2 passed; 0 failed') }), { ok: true, summary: '5 passed' });
  assert.equal(testVerdict({ stdout: ' Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 40 passed (42)' }).ok, false);
  assert.deepEqual(testVerdict({ stdout: ' Test Files  3 passed (3)\n      Tests  42 passed (42)' }), { ok: true, summary: '42 passed' });
  assert.equal(testVerdict({ stdout: 'Tests:       1 failed, 2 passed, 3 total' }).ok, false);
  assert.equal(testVerdict({ stdout: '==== 3 passed in 0.12s ====' }).ok, true);
  assert.equal(testVerdict({ stdout: '=== 0 failed, 1 error ===\n=== 1 failed, 2 passed in 0.3s ===' }).ok, false);
  assert.equal(testVerdict({ stdout: '  3 passing (20ms)\n  1 failing' }).ok, false);
  assert.equal(testVerdict({ stdout: '--- FAIL: TestX (0.00s)\nFAIL\tpkg\t0.1s' }).ok, false);
  assert.deepEqual(testVerdict({ stdout: '# tests 4\n# pass 4\n# fail 0' }), { ok: true, summary: '4 passed' });
  assert.equal(testVerdict({ stdout: '# tests 4\n# pass 3\n# fail 1' }).ok, false);
  assert.equal(testVerdict({ stdout: 'nothing to see' }), null);
});

test('ids that reach an object\'s prototype, odd times and colors never get into the state', () => {
  const st = createState(BOARD);
  const proto = { id: 'p1', ts: at(1), by: '__proto__', type: 'agent.status', status: 'working', doing: 'x' };
  assert.match(checkEvent(st, proto, at(1)), /isn't a valid agent id/);
  for (const by of ['constructor', 'prototype', 'a b', 'x'.repeat(81)]) assert.ok(checkEvent(st, { ...proto, by }, at(1)), by);
  // A log edited by hand is folded without them.
  apply(st, proto);
  apply(st, { ...proto, by: 'a1', block: '__proto__', type: 'block.reserve' });
  assert.equal(({}).status, undefined);
  assert.equal(Object.keys(st.agents).join(), HUMAN);
  const join = makeEvent(st, 'agent.join', 'a1', { agent: { id: 'a1' } }, at(1));
  assert.match(checkEvent(st, { ...join, ts: '1"><b>' }, at(1)), /needs a time/);
  apply(st, { ...join, ts: '1"><b>' });
  assert.equal(st.agents.a1, undefined);
  assert.match(checkEvent(st, { ...join, ts: at(90) }, at(1)), /in the future/);
  assert.match(checkEvent(st, { ...join, agent: { id: 'a1', color: 'red;background:url(x)' } }, at(1)), /Colors are/);
  assert.equal(checkEvent(st, { ...join, agent: { id: 'a1', color: 'violet' } }, at(1)), null);
  // Enums are checked on the way in.
  assert.match(ev(st, 'block.reserve', 'a1', { block: 'engine', mode: 'steal' }, 1).why, /Modes are/);
  assert.match(ev(st, 'agent.status', 'a1', { status: 'asleep' }, 1).why, /Statuses are/);
  assert.match(ev(st, 'agent.leave', 'a1', { outcome: 'vanished' }, 1).why, /Outcomes are/);
  assert.match(ev(st, 'item.add', 'a1', { item: { kind: 'epic', title: 'x' } }, 1).why, /Kinds are/);
  assert.match(ev(st, 'block.explode', 'a1', {}, 1).why, /No event type/);
  // `bm --as __proto__` is refused before it writes anything.
  const t = tmpBoard();
  try {
    const env = { ...hookEnv(t.dir), BLOCKMAP_DIR: t.boardDir };
    const res = spawnSync(process.execPath, [path.join(HERE, '..', 'cli.js'), 'doing', 'x', '--as', '__proto__'], { env, encoding: 'utf8' });
    assert.equal(res.status, 3);
    assert.match(res.stderr, /isn't a valid agent id/);
  } finally {
    t.done();
  }
});

test('only the human forces a reservation or acts for another agent', () => {
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1', name: 'Heron' } }, 0);
  run(st, 'agent.join', 'a2', { agent: { id: 'a2', name: 'Basalt' } }, 0);
  run(st, 'block.reserve', HUMAN, { block: 'tables' }, 1);
  run(st, 'block.reserve', 'a1', { block: 'engine' }, 1);
  run(st, 'block.freeze', HUMAN, { block: 'pass', on: true }, 1);
  assert.match(ev(st, 'block.reserve', 'a2', { block: 'tables', force: true }, 2).why, /Only the human can force/);
  assert.match(ev(st, 'block.reserve', 'a2', { block: 'pass', force: true }, 2).why, /Only the human can force/);
  assert.match(ev(st, 'block.release', 'a2', { block: 'engine', agent: 'a1' }, 2).why, /Only the human acts for another agent/);
  assert.match(ev(st, 'agent.leave', 'a2', { agent: 'a1' }, 2).why, /Only the human acts for another agent/);
  // The same moves in a log edited by hand fold as the agent acting for itself.
  apply(st, makeEvent(st, 'block.release', 'a2', { block: 'engine', agent: 'a1', force: true }, at(3)));
  assert.equal(st.blocks.engine.holder, 'a1');
  apply(st, makeEvent(st, 'agent.leave', 'a2', { agent: 'a1' }, at(3)));
  assert.equal(st.agents.a1.leftAt, 0);
  assert.deepEqual(st.agents.a1.held, ['engine']);
  // The human can.
  run(st, 'block.release', HUMAN, { block: 'engine', agent: 'a1', outcome: 'parked' }, 4);
  run(st, 'block.reserve', HUMAN, { block: 'pass', agent: 'a1' }, 5);
  assert.equal(st.blocks.pass.holder, 'a1');
});

test('a branch with nothing ahead of the base is never queued, and a quiet agent gives up its color', () => {
  const st = createState(BOARD);
  run(st, 'agent.join', 'a1', { agent: { id: 'a1' } }, 0);
  assert.match(ev(st, 'merge.ready', 'a1', { worktree: 'one', commit: 'aaa', ahead: 0 }, 1).why, /Nothing to merge/);
  run(st, 'merge.ready', 'a1', { worktree: 'one', commit: 'aaa', ahead: 2 }, 1);
  assert.equal(st.merges.one.ahead, 2);
  run(st, 'agent.join', 'a2', { agent: { id: 'a2' } }, 1);
  const first = st.agents.a1.color;
  assert.notEqual(st.agents.a2.color, first);
  // a1's session crashed without leaving; seven hours on, a newcomer may wear its color.
  run(st, 'agent.status', 'a2', { status: 'working' }, 7 * 60);
  run(st, 'agent.join', 'a3', { agent: { id: 'a3' } }, 7 * 60 + 1);
  assert.equal(st.agents.a3.color, first);
});

test('the board carries its base branch through', async () => {
  const { resolveBoard } = await import('../core/resolve.js');
  const b = resolveBoard({ root: os.tmpdir(), readConfig: () => ({ ...BOARD, base: 'develop' }) }, { items: false });
  assert.equal(b.base, 'develop');
});

test('the git watcher primes a new worktree and leaves out what HEAD moved', async () => {
  const { gitEdits } = await import('../server.js');
  let times = { 'a.ts': 1, 'b.ts': 1 };
  const wt = (head) => ({ name: 'w', path: '/w', main: false, head, files: ['a.ts', 'b.ts'] });
  const opts = { mtime: (dir, f) => times[f] ?? -1, headDiff: async () => new Set(['b.ts']) };
  let r = await gitEdits(new Map(), [wt('h1')], opts);
  assert.deepEqual(r.changes, []);
  times['a.ts'] = 2;
  r = await gitEdits(r.next, [wt('h1')], opts);
  assert.deepEqual(r.changes.map((c) => c.files), [['a.ts']]);
  // A checkout rewrote b.ts; a.ts was edited by hand.
  times = { 'a.ts': 3, 'b.ts': 3 };
  r = await gitEdits(r.next, [wt('h2')], opts);
  assert.deepEqual(r.changes.map((c) => c.files), [['a.ts']]);
  // When git can't say what moved, nothing is reported for that poll.
  times = { 'a.ts': 4, 'b.ts': 4 };
  r = await gitEdits(r.next, [wt('h3')], { ...opts, headDiff: async () => null });
  assert.deepEqual(r.changes, []);
});

test('the server stamps what it is sent, answers only on localhost, and resumes its stream', async () => {
  const t = tmpBoard();
  const saved = { ...process.env };
  process.env.BLOCKMAP_DIR = t.boardDir;
  for (const k of ['BLOCKMAP_LIVE', 'BLOCKMAP_TOKEN']) delete process.env[k];
  const { serve } = await import('../server.js');
  let server;
  try {
    await assert.rejects(serve({ host: '0.0.0.0', port: 0, quiet: true }), /BLOCKMAP_TOKEN/);
    server = await serve({ port: 0, quiet: true });
    const port = server.address().port;
    const req = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'x-blockmap': '1', 'content-type': 'application/json', ...headers } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      r.on('error', reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
    const posted = await req('POST', '/api/commit', { body: { events: [{ id: 'mine', ts: '"><img src=x onerror=alert(1)>', by: 'a1', type: 'agent.join', agent: { id: 'a1' } }, { id: 'later', ts: 9e15, by: 'a1', type: 'block.reserve', block: 'engine' }] } });
    assert.equal(posted.status, 200, posted.body);
    const accepted = JSON.parse(posted.body).accepted;
    for (const e of accepted) {
      assert.equal(typeof e.ts, 'number');
      assert.ok(Math.abs(e.ts - Date.now()) < 60_000);
      assert.ok(!['mine', 'later'].includes(e.id));
      assert.equal(e.by, 'a1');
    }
    assert.equal((await req('POST', '/api/commit', { body: { events: [{ by: '__proto__', type: 'agent.status', status: 'working' }] } })).status, 409);
    assert.equal((await req('GET', '/api/board', { headers: { host: 'evil.example:4477' } })).status, 403);
    assert.equal((await req('GET', '/', { headers: { host: 'localhost.evil.example' } })).status, 403);
    const log = await req('GET', '/api/events', { headers: { host: `localhost:${port}` } });
    assert.equal(log.status, 200);
    const offset = Number(log.headers['x-blockmap-offset']);
    assert.equal(offset, fs.statSync(path.join(t.boardDir, 'live', 'events.jsonl')).size);
    // A page that reconnects with the last offset it saw gets what came after, with the new offset as the id.
    const before = JSON.parse(log.body);
    await req('POST', '/api/commit', { body: { events: [{ by: 'a1', type: 'note', text: 'after the read' }] } });
    const chunk = await new Promise((resolve, reject) => {
      const r = http.get({ host: '127.0.0.1', port, path: '/api/stream', headers: { 'last-event-id': String(offset) } }, (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
          if (/event: events\n/.test(data) && data.endsWith('\n\n')) {
            r.destroy();
            resolve(data);
          }
        });
      });
      r.on('error', reject);
    });
    const block = chunk.split('\n\n').find((b) => b.includes('event: events'));
    const sent = JSON.parse(/^data: (.*)$/m.exec(block)[1]);
    assert.deepEqual(sent.map((e) => e.text), ['after the read']);
    assert.equal(Number(/^id: (\d+)$/m.exec(block)[1]), fs.statSync(path.join(t.boardDir, 'live', 'events.jsonl')).size);
    assert.equal(before.length, 2);
  } finally {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    t.done();
  }
});

test('a second review: remote writes, a bad agent id, long worktree names, old queue entries, every loopback', async () => {
  // A board served elsewhere (BLOCKMAP_URL): reading and writing fold what came back.
  const { remoteStore } = await import('../core/store.js');
  const accepted = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/api/board')) return res.end(JSON.stringify(BOARD));
      if (req.url.startsWith('/api/events')) return res.end('[]');
      const list = JSON.parse(body).events.map((e, i) => ({ ...e, id: `e${i}`, ts: Date.now() }));
      accepted.push(...list);
      return res.end(JSON.stringify({ accepted: list }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const remote = remoteStore(`http://127.0.0.1:${srv.address().port}`);
    assert.ok((await remote.state()).blocks);
    const out = await remote.commit([{ type: 'agent.join', by: 'agent-1', agent: { id: 'agent-1' } }]);
    assert.ok(out.state.agents['agent-1']);
  } finally {
    srv.close();
  }

  // An id the board refuses never blocks an edit: the hooks fail open.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockmap-badid-'));
  fs.mkdirSync(path.join(dir, '.blockmap'));
  fs.writeFileSync(path.join(dir, '.blockmap', 'board.json'), JSON.stringify(BOARD));
  try {
    const hook = path.join(HERE, '..', 'hooks', 'claude-code.js');
    const env = { ...process.env, BLOCKMAP_LIVE: path.join(dir, '.blockmap', 'live'), BLOCKMAP_AGENT: 'agent 1' };
    const out = execFileSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'PreToolUse', session_id: 'cccc0000', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/engine/pass.ts') } }), env, encoding: 'utf8' });
    assert.equal(out, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const { worktreeAgentId } = await import('../core/model.js');
  const long = worktreeAgentId('x'.repeat(200));
  assert.ok(long.length <= 80 && long.startsWith('wt-'));
  const state = reduce(BOARD, []);
  assert.equal(checkEvent(state, makeEvent(state, 'agent.join', long, { agent: { id: long } })), null);

  const { isLoopbackHostHeader } = await import('../server.js');
  assert.ok(isLoopbackHostHeader('127.0.0.2:4477'));
  assert.ok(isLoopbackHostHeader('localhost:4477'));
  assert.ok(!isLoopbackHostHeader('attacker.example'));
});
