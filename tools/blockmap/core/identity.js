// Who is talking to the board, and from where. Node only; shared by the CLI and the hooks.

import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HUMAN, safeId, worktreeAgentId } from './model.js';

// An explicit `--as`, then BLOCKMAP_AGENT, then a Claude Code session, then the worktree the command runs in
// (any agent, on any model, that works in its own worktree is that worktree), then the person at the shell.
export function whoAmI(explicit, cwd = process.cwd()) {
  if (explicit) return String(explicit);
  if (process.env.BLOCKMAP_AGENT) return process.env.BLOCKMAP_AGENT;
  const session = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (session) return sessionAgentId(session);
  const wt = worktreeHere(cwd);
  if (wt?.linked) return worktreeAgentId(path.basename(wt.path));
  return HUMAN;
}

// The checkout a directory belongs to, and whether it is a linked worktree rather than the main one.
export function worktreeHere(cwd = process.cwd()) {
  try {
    const run = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const top = run(['rev-parse', '--show-toplevel']);
    const gitDir = path.resolve(cwd, run(['rev-parse', '--git-dir']));
    const common = path.resolve(cwd, run(['rev-parse', '--git-common-dir']));
    return { path: top, linked: gitDir !== common };
  } catch {
    return null;
  }
}

export function sessionAgentId(sessionId) {
  return `cc-${String(sessionId).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
}

export function whereAmI(cwd = process.cwd()) {
  let branch = '';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // Not in git.
  }
  const host = os.hostname().split('.')[0];
  const remote = process.env.CLAUDE_CODE_REMOTE === 'true' ? 'cloud' : host;
  return [remote, path.basename(cwd), branch].filter(Boolean).join(', ');
}

// What the agent runs in, as the agent's own environment says; BLOCKMAP_KIND names any other harness.
export function agentKind(id) {
  if (process.env.BLOCKMAP_KIND) return process.env.BLOCKMAP_KIND;
  if (id === HUMAN) return 'human';
  if (id.startsWith('cc-') || process.env.CLAUDECODE) return 'Claude Code';
  if (id.startsWith('wt-')) return 'worktree';
  return 'agent';
}
