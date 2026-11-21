// Worktrees on the board: which agent works in each, which blocks each changed, and whether each queued
// branch is fit to merge. Pure, so the CLI and the page share it. Runs in Node and the browser.

import { blockForPath } from './glob.js';
import { HUMAN, UNMAPPED, mergeQueue, agentName, worktreeAgentId } from './model.js';

// The agent working in a worktree: the newest present agent that joined from it, else the watcher's
// stand-in (`wt-<name>`), which exists for agents that never talk to the board.
export function agentForWorktree(state, wt) {
  let best = null;
  for (const a of Object.values(state.agents)) {
    if (a.id === HUMAN || a.leftAt || !a.worktree) continue;
    if (a.worktree !== wt.path && a.worktree !== wt.name) continue;
    if (!best || a.lastSeen > best.lastSeen) best = a;
  }
  if (best) return best.id;
  const standIn = state.agents[worktreeAgentId(wt.name)];
  return standIn && !standIn.leftAt ? standIn.id : null;
}

export function blocksOf(state, wt) {
  const out = new Map();
  for (const f of wt.files || []) {
    const id = blockForPath(state.index, f) || UNMAPPED;
    out.set(id, (out.get(id) || 0) + 1);
  }
  return out;
}

// Block id to the worktrees (other than the main checkout) that changed something in it.
export function worktreesByBlock(state, snap) {
  const out = new Map();
  for (const wt of snap?.list || []) {
    if (wt.main) continue;
    for (const id of blocksOf(state, wt).keys()) {
      if (!out.has(id)) out.set(id, []);
      out.get(id).push(wt.name);
    }
  }
  return out;
}

// danger: the merge would fail or break things. warn: it needs a step first. info: worth knowing.
const RANK = { ok: 0, info: 1, warn: 2, danger: 3 };

// Each queued branch with the checks a merge would care about, worst first, and a one-word-ish verdict.
// Overlaps count against branches ahead in the queue: those land first and will move the files under it.
export function mergeChecks(state, snap, now) {
  const byName = new Map((snap?.list || []).map((wt) => [wt.name, wt]));
  const base = snap?.base || 'base';
  const clashes = snap?.clashes || [];
  const label = (name) => {
    const wt = byName.get(name);
    const agent = wt ? agentForWorktree(state, wt) : null;
    return agent ? agentName(state, agent) : name;
  };
  const ahead = [];
  return mergeQueue(state, now).map((m) => {
    if (m.status === 'landed') return { entry: m, wt: byName.get(m.worktree) || null, checks: [], level: 'ok', verdict: 'Merged', label: m.agent && state.agents[m.agent] ? agentName(state, m.agent) : label(m.worktree) };
    const wt = byName.get(m.worktree) || null;
    const checks = [];
    if (!wt) checks.push({ level: 'danger', text: 'Worktree gone' });
    else {
      if (wt.conflicts.length) checks.push({ level: 'danger', text: `Conflicts with ${base}`, files: wt.conflicts });
      for (const prev of ahead) {
        const clash = clashes.find((c) => (c.a === prev.name && c.b === wt.name) || (c.b === prev.name && c.a === wt.name));
        if (clash) checks.push({ level: 'danger', text: `Conflicts with ${label(prev.name)}`, files: clash.files, with: prev.name });
        else {
          const shared = prev.files.filter((f) => wt.files.includes(f));
          if (shared.length) checks.push({ level: 'info', text: `Shares files with ${label(prev.name)}`, files: shared });
        }
      }
      const agent = agentForWorktree(state, wt);
      const test = agent ? state.agents[agent]?.lastTest : null;
      if (test && !test.ok) checks.push({ level: 'danger', text: 'Tests fail', detail: test.summary });
      if (!wt.conflicts.length && wt.behind) checks.push({ level: 'warn', text: `${wt.behind} behind ${base}`, action: 'rebase' });
      if (m.commit && wt.head && !wt.head.startsWith(m.commit) && !m.commit.startsWith(wt.head)) checks.push({ level: 'warn', text: 'Moved since ready' });
      if (wt.ahead === 0) checks.push({ level: 'info', text: 'Nothing to merge' });
      if (wt.dirty) checks.push({ level: 'info', text: `${wt.dirty} uncommitted` });
      if (!test) checks.push({ level: 'info', text: 'No test run' });
      ahead.push({ name: wt.name, files: wt.files });
    }
    checks.sort((a, b) => RANK[b.level] - RANK[a.level]);
    const top = checks[0];
    const level = !top || top.level === 'info' ? 'ok' : top.level;
    return { entry: m, wt, checks, level, verdict: level === 'ok' ? (top ? `Ready, ${top.text.toLowerCase()}` : 'Ready') : top.text, label: label(m.worktree) };
  });
}

export function mergeCommand(entry, base) {
  return `git merge --no-ff ${entry.branch || entry.worktree}${base ? `  # into ${base}` : ''}`;
}

export function describeWorktreeAgent(state, wt) {
  const id = agentForWorktree(state, wt);
  return id ? agentName(state, id) : '';
}
