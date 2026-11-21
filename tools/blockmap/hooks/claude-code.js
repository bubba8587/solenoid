#!/usr/bin/env node
// Claude Code hooks for Blockmap. One script for every hook event; it reads the hook's JSON on
// stdin. It fails open: if anything here breaks, the tool call goes ahead as if Blockmap weren't
// installed. `bm hooks install` wires it into .claude/settings.local.json.
//
//   SessionStart       join the board, hand the agent a short briefing
//   UserPromptSubmit   mark the agent working, deliver the human's messages
//   PreToolUse         an edit inside another agent's (or the human's, or a frozen) block is refused
//                      with the reason; an edit in a free block reserves it, per the board's guard
//   PostToolUse        record the edit or the command, guess test results, deliver messages
//   Notification       a permission prompt or a long wait: the agent needs the human
//   Stop               the turn ended: the agent waits for the human's next prompt
//   SessionEnd         leave the board, releasing what the agent held

import fs from 'node:fs';
import path from 'node:path';
import { openStore, findBoardDir } from '../core/store.js';
import { reduce, makeEvent, blockMeta, agentName, isStale, clock, itemCounts, HUMAN } from '../core/model.js';
import { blockForPath, normalizePath } from '../core/glob.js';
import { sessionAgentId, whereAmI, worktreeHere } from '../core/identity.js';
import { lineCounts } from './lines.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const TEST_CMD = /\b(vitest|jest|mocha|pytest|cargo (nextest|test)|npm (run )?test|go test|node --test|test-bucket|cargo-test)\b/;
const CLI = 'tools/blockmap/bm';

async function main() {
  if (process.env.BLOCKMAP === 'off') return;
  const raw = await readStdin();
  const input = raw.trim() ? JSON.parse(raw) : {};
  const cwd = input.cwd || process.cwd();
  const dir = findBoardDir(cwd);
  if (!dir) return;
  const store = openStore(dir);
  const me = process.env.BLOCKMAP_AGENT || sessionAgentId(input.session_id || process.env.CLAUDE_CODE_SESSION_ID || 'session');
  const board = store.board();
  const guard = { held: 'deny', frozen: 'deny', free: 'reserve', ...(board.guard || {}) };
  const now = Date.now();
  let state = reduce(board, store.readEvents());
  const cli = path.relative(cwd, path.join(store.root, CLI)) || CLI;

  const commit = (events) => {
    if (!events.length) return;
    try {
      state = store.commit(events, now).state;
    } catch {
      // A refused event (a race for the same block) changes nothing; the edit decides below.
    }
  };
  const ev = (type, payload) => makeEvent(state, type, me, payload, now);
  const joined = () => {
    const a = state.agents[me];
    return a && !a.leftAt && a.joinedAt;
  };
  const ensureJoined = () => {
    if (joined()) return [];
    return [ev('agent.join', { agent: { id: me, kind: 'Claude Code', where: whereAmI(cwd), worktree: worktreeHere(cwd)?.path || '', model: process.env.BLOCKMAP_MODEL || '' }, task: '' })];
  };

  switch (input.hook_event_name) {
    case 'SessionStart': {
      commit(ensureJoined());
      return context('SessionStart', briefing(state, me, now, cli));
    }

    case 'UserPromptSubmit': {
      const a = state.agents[me];
      const prompt = String(input.prompt || '').split('\n').find((l) => l.trim()) || '';
      const events = [...ensureJoined()];
      const task = a?.task || prompt.slice(0, 90);
      events.push(ev('agent.status', { status: 'working', doing: 'Reading the prompt', ...(a?.task ? {} : { task }) }));
      commit(events);
      return context('UserPromptSubmit', inboxText(state, me, commit, ev));
    }

    case 'PreToolUse': {
      if (!EDIT_TOOLS.has(input.tool_name)) return undefined;
      const file = relFile(store.root, input.tool_input?.file_path || input.tool_input?.notebook_path);
      if (!file) return undefined;
      const id = blockForPath(state.index, file);
      if (!id) return undefined;
      const b = state.blocks[id];
      const meta = blockMeta(state, id);
      if (b.holder === me) return undefined;
      if (b.frozen && guard.frozen !== 'allow') {
        return decide(guard.frozen, `${file} is in ${meta.name}, which ${agentName(state, b.frozen.by)} froze${b.frozen.note ? ` (${b.frozen.note})` : ''}. Don't edit there until it's unfrozen; pick other work or ask with \`${cli} ask "…"\`.`);
      }
      if (b.holder && (b.holder === HUMAN || !isStale(state, b.holder, now)) && guard.held !== 'allow') {
        const who = b.holder === HUMAN ? `${agentName(state, HUMAN)} (the human)` : agentName(state, b.holder);
        return decide(
          guard.held,
          `${file} is in ${meta.name}, held by ${who} since ${clock(b.since)}${b.intent ? ` for "${b.intent}"` : ''}. Leave it to them: work elsewhere, message them (\`${cli} msg ${b.holder === HUMAN ? 'human' : agentName(state, b.holder)} "…"\`), or ask the human to move the block to you.`,
        );
      }
      if (guard.free === 'deny') return decide('deny', `${file} is in ${meta.name}, which you haven't reserved. Reserve it first: \`${cli} reserve ${id} --for "<what you'll do>"\`.`);
      if (guard.free === 'reserve') {
        const a = state.agents[me];
        const takeover = b.holder ? ` (taking over from ${agentName(state, b.holder)}, quiet since ${clock(state.agents[b.holder]?.lastSeen || b.since)})` : '';
        commit([...ensureJoined(), ev('block.reserve', { block: id, intent: a?.task || `editing ${path.basename(file)}` })]);
        if (state.blocks[id].holder === me) {
          const c = itemCounts(state, id);
          const open = [c.bug && `${c.bug} open bug${c.bug > 1 ? 's' : ''}`, c.task && `${c.task} open task${c.task > 1 ? 's' : ''}`, c.decision && `${c.decision} waiting on the human`].filter(Boolean).join(', ');
          note(store, me, `Blockmap reserved ${meta.name} (${id}) for you${takeover}, since you're editing ${file}.${meta.docs?.length ? ` Read before changing it: ${meta.docs.join(', ')}.` : ''}${open ? ` Open there: ${open} (\`${cli} show ${id}\`).` : ''} Release it when the work lands: \`${cli} release ${id} --landed\`.`);
        }
      }
      return undefined;
    }

    case 'PostToolUse': {
      const events = [];
      if (EDIT_TOOLS.has(input.tool_name)) {
        const file = relFile(store.root, input.tool_input?.file_path || input.tool_input?.notebook_path);
        if (file) {
          events.push(ev('touch', { files: [file], op: 'edit', ...lineCounts(input.tool_name, input.tool_input, input.tool_response) }));
          events.push(ev('agent.status', { status: 'working', doing: `Editing ${file}` }));
        }
      } else if (input.tool_name === 'Bash') {
        const cmd = String(input.tool_input?.command || '').replace(/\s+/g, ' ').trim();
        if (cmd) {
          events.push(ev('touch', { op: 'run', cmd: cmd.slice(0, 140) }));
          const verdict = TEST_CMD.test(cmd) ? testVerdict(input.tool_response) : null;
          if (verdict) events.push(ev('test', verdict));
        }
      }
      if (events.length && joined()) commit(events);
      else if (events.length) commit([...ensureJoined(), ...events]);
      const parts = [takeNotes(store, me), inboxText(state, me, commit, ev)].filter(Boolean);
      return parts.length ? context('PostToolUse', parts.join('\n\n')) : undefined;
    }

    case 'Notification': {
      // Claude Code says it needs a permission or has sat waiting for input; either way the human is up.
      const message = String(input.message || '').trim();
      if (joined()) commit([ev('agent.status', { status: 'waiting', doing: message || 'Needs your attention' })]);
      return undefined;
    }

    case 'Stop': {
      const a = state.agents[me];
      if (a && !a.leftAt && a.status !== 'review') commit([ev('agent.status', { status: 'review', doing: 'Finished the turn' })]);
      return undefined;
    }

    case 'SessionEnd': {
      if (joined()) commit([ev('agent.leave', { note: input.reason ? `session ended (${input.reason})` : 'session ended' })]);
      return undefined;
    }

    default:
      return undefined;
  }
}

function briefing(state, me, now, cli) {
  const a = state.agents[me];
  const others = Object.values(state.agents).filter((x) => x.id !== me && x.id !== HUMAN && !x.leftAt && !isStale(state, x.id, now));
  const lines = [
    `Blockmap: you are ${a.name} (${me}) on the ${state.board.name} board, where the human watches which agent works in which block of the repository.`,
    `Editing a file in a free block reserves that block for you; editing inside a block another agent or the human holds is refused. Release blocks when the work lands: \`${cli} release --landed\`. Say what you're doing with \`${cli} doing "…"\`, file bugs with \`${cli} bug "…"\`, ask the human with \`${cli} ask "…"\`. \`${cli} help\` lists the rest.`,
  ];
  if (others.length) lines.push(`Working now: ${others.map((x) => `${x.name} holds ${x.held.length ? x.held.join(', ') : 'nothing'}${x.task ? ` (${x.task})` : ''}`).join('; ')}.`);
  const human = state.agents[HUMAN];
  if (human.held.length) lines.push(`The human holds ${human.held.join(', ')}: stay out.`);
  const frozen = Object.values(state.blocks).filter((b) => b.frozen);
  if (frozen.length) lines.push(`Frozen: ${frozen.map((b) => b.id).join(', ')}.`);
  const q = Object.values(state.blocks).filter((b) => b.queued && !b.holder).sort((x, y) => x.queued.pos - y.queued.pos);
  if (q.length) lines.push(`The human's queue: ${q.map((b) => `${b.id}${b.queued.note ? ` ("${b.queued.note}")` : ''}`).join(', ')}. \`${cli} next\` takes the first.`);
  if (a.held.length) lines.push(`You still hold ${a.held.join(', ')} from earlier.`);
  return lines.join('\n');
}

function inboxText(state, me, commit, ev) {
  const a = state.agents[me];
  if (!a?.inbox.length) return '';
  const msgs = a.inbox.map((m) => `- ${clock(m.ts)} ${agentName(state, m.from)}: ${m.text}`);
  commit([ev('msg.read', { ids: a.inbox.map((m) => m.id) })]);
  return `Messages on the Blockmap board for you:\n${msgs.join('\n')}`;
}

// Notes the PreToolUse hook leaves for the PostToolUse hook to say, so they reach the agent as context.
function notesPath(store, me) {
  return path.join(store.live, 'hooks', `${me}.json`);
}
function note(store, me, text) {
  const p = notesPath(store, me);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // First note.
  }
  list.push(text);
  fs.writeFileSync(p, JSON.stringify(list));
}
function takeNotes(store, me) {
  const p = notesPath(store, me);
  try {
    const list = JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.rmSync(p, { force: true });
    return list.join('\n');
  } catch {
    return '';
  }
}

function testVerdict(response) {
  const text = typeof response === 'string' ? response : [response?.stdout, response?.stderr, response?.output].filter(Boolean).join('\n');
  if (!text) return null;
  // vitest and jest print a "Tests" line under "Test Files"; it's the count people mean.
  const tests = /^\s*Tests:?\s+.*$/m.exec(text);
  const hay = tests ? tests[0] : text;
  const failed = /(\d+)\s+(failed|failing)\b/i.exec(hay) || /\btest result: FAILED\b/.exec(hay) || (!tests && /\bFAIL\b/.exec(hay));
  const passed = /(\d+)\s+(passed|passing)\b/i.exec(hay) || /\btest result: ok\b/.exec(hay);
  if (failed && !(failed[1] === '0')) return { ok: false, summary: tail(failed[0]) };
  if (passed) return { ok: true, summary: tail(passed[0]) };
  return null;
}

function tail(s) {
  return String(s).slice(0, 80);
}

function relFile(root, file) {
  if (!file) return null;
  const abs = path.resolve(file);
  if (!abs.startsWith(root + path.sep)) return null;
  return normalizePath(path.relative(root, abs));
}

function context(hookEventName, text) {
  if (!text) return undefined;
  return { hookSpecificOutput: { hookEventName, additionalContext: text } };
}

function decide(mode, reason) {
  if (mode === 'warn') return undefined;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: mode === 'ask' ? 'ask' : 'deny', permissionDecisionReason: `Blockmap: ${reason}` } };
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

main()
  .then((out) => {
    if (out) process.stdout.write(JSON.stringify(out));
  })
  .catch((err) => {
    try {
      const dir = findBoardDir(process.cwd());
      if (dir) fs.appendFileSync(path.join(dir, 'live', 'hook-errors.log'), `${new Date().toISOString()} ${err.stack || err}\n`);
    } catch {
      // Nowhere to log; fail open regardless.
    }
  })
  .finally(() => process.exit(0));
