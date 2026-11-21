// Wires the Blockmap hooks into a project's .claude/settings.local.json (per machine, ignored by
// git), or takes them out. Entries are recognized by the script path, so install is idempotent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude-code.js');
const EVENTS = {
  SessionStart: null,
  UserPromptSubmit: null,
  PreToolUse: 'Edit|Write|MultiEdit|NotebookEdit',
  PostToolUse: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
  Stop: null,
  SessionEnd: null,
};

export function hookConfig(root) {
  const rel = path.relative(root, SCRIPT).split(path.sep).join('/');
  const command = `node "$CLAUDE_PROJECT_DIR/${rel}"`;
  const hooks = {};
  for (const [event, matcher] of Object.entries(EVENTS)) {
    hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 10 }] }];
  }
  return { hooks };
}

const ours = (entry) => (entry.hooks || []).some((x) => String(x.command || '').includes('blockmap/hooks/claude-code.js'));

export function installHooks(root, action = 'print') {
  const file = path.join(root, '.claude', 'settings.local.json');
  const config = hookConfig(root);
  if (action === 'print') {
    return { message: `Add this to .claude/settings.local.json (or run \`bm hooks install\`):\n${JSON.stringify(config, null, 2)}`, config };
  }
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // No local settings yet.
  }
  settings.hooks ||= {};
  for (const event of Object.keys(EVENTS)) {
    const kept = (settings.hooks[event] || []).filter((e) => !ours(e));
    if (action === 'install') kept.push(...config.hooks[event]);
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return {
    message:
      action === 'install'
        ? `Installed the Blockmap hooks in ${path.relative(root, file)}. New Claude Code sessions here join the board; \`BLOCKMAP=off\` turns them off for one session, \`bm hooks uninstall\` for good.`
        : `Removed the Blockmap hooks from ${path.relative(root, file)}.`,
    file,
  };
}
