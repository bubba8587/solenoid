// Listing a checkout's files, and the ones changed in it. Node only.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function gitFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split('\n').filter(Boolean))];
  } catch {
    return walk(root);
  }
}

function walk(root) {
  const out = [];
  const skip = new Set(['.git', 'node_modules', 'target', 'dist', '.blockmap']);
  (function go(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) go(path.join(dir, e.name), r);
      else out.push(r);
    }
  })(root, '');
  return out;
}

export function changedFiles(root, { staged = false, since = null } = {}) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  if (staged) return run(['diff', '--cached', '--name-only']);
  if (since) return run(['diff', '--name-only', `${since}...HEAD`]).concat(run(['diff', '--name-only']));
  return [...new Set(run(['diff', '--name-only', 'HEAD']).concat(run(['ls-files', '--others', '--exclude-standard'])))];
}
