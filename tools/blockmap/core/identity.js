// Who is talking to the board, and from where. Node only; shared by the CLI and the hooks.

import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HUMAN } from './model.js';

// An explicit `--as`, then BLOCKMAP_AGENT, then a Claude Code session, then the person at the shell.
export function whoAmI(explicit) {
  if (explicit) return String(explicit);
  if (process.env.BLOCKMAP_AGENT) return process.env.BLOCKMAP_AGENT;
  const session = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID;
  if (session) return sessionAgentId(session);
  return HUMAN;
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
  return [remote, path.basename(cwd), branch].filter(Boolean).join(' · ');
}

export function agentKind(id) {
  if (id === HUMAN) return 'human';
  if (id.startsWith('cc-') || process.env.CLAUDECODE) return 'claude-code';
  return process.env.BLOCKMAP_KIND || 'agent';
}
