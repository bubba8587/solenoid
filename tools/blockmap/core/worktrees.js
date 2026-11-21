// Every worktree of the repository as git sees it: its branch, how far it is ahead of and behind the base
// branch, the files and lines it changed since it branched (uncommitted work included), and the files that
// would conflict if it merged now (a dry-run merge, `git merge-tree`, which touches nothing). Node only.
//
// Nothing here needs the agent's cooperation, which is what makes the board work with any agent on any
// model: whatever edits files in a worktree shows up.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, code: err ? err.code ?? 1 : 0, out: String(stdout || '').trim() });
    });
  });
}

export async function listWorktrees(root) {
  const res = await git(root, ['worktree', 'list', '--porcelain']);
  if (!res.ok) return [];
  const out = [];
  for (const chunk of res.out.split(/\n\s*\n/)) {
    const wt = { path: '', head: '', branch: '', detached: false, bare: false, locked: false, prunable: false };
    for (const line of chunk.split('\n')) {
      const [key, ...rest] = line.split(' ');
      const val = rest.join(' ');
      if (key === 'worktree') wt.path = val;
      else if (key === 'HEAD') wt.head = val;
      else if (key === 'branch') wt.branch = val.replace(/^refs\/heads\//, '');
      else if (key === 'detached') wt.detached = true;
      else if (key === 'bare') wt.bare = true;
      else if (key === 'locked') wt.locked = true;
      else if (key === 'prunable') wt.prunable = true;
    }
    if (wt.path) out.push(wt);
  }
  out.forEach((wt, i) => {
    wt.main = i === 0;
  });
  return out;
}

// The branch work merges into: the board's `base`, else the remote's default, else main or master.
export async function baseRef(root, configured) {
  const exists = async (ref) => (await git(root, ['rev-parse', '--verify', '--quiet', ref])).ok;
  const names = configured ? [configured] : [];
  const remoteHead = await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (remoteHead.ok) names.push(remoteHead.out.replace(/^origin\//, ''));
  names.push('main', 'master', 'develop');
  for (const name of names) {
    if (await exists(`refs/heads/${name}`)) return { name, ref: name };
    if (await exists(`refs/remotes/origin/${name}`)) return { name, ref: `origin/${name}` };
  }
  return { name: 'HEAD', ref: 'HEAD' };
}

export function worktreeName(wt) {
  return wt.main ? 'main' : path.basename(wt.path);
}

export async function worktreeSnapshot(root, { base } = {}) {
  const list = await listWorktrees(root);
  const b = await baseRef(root, base);
  const rows = await Promise.all(list.filter((wt) => !wt.bare && !wt.prunable && fs.existsSync(wt.path)).map((wt) => inspect(wt, b)));
  return { base: b.name, at: Date.now(), list: rows };
}

async function inspect(wt, base) {
  const cwd = wt.path;
  const row = {
    name: worktreeName(wt),
    path: wt.path,
    main: wt.main,
    branch: wt.branch || (wt.detached ? 'detached' : ''),
    head: wt.head,
    ahead: 0,
    behind: 0,
    dirty: 0,
    files: [],
    add: 0,
    del: 0,
    conflicts: [],
    lastCommit: null,
  };
  const [counts, mb, status, last] = await Promise.all([
    git(cwd, ['rev-list', '--left-right', '--count', `${base.ref}...HEAD`]),
    git(cwd, ['merge-base', base.ref, 'HEAD']),
    git(cwd, ['status', '--porcelain', '--untracked-files=all']),
    git(cwd, ['log', '-1', '--format=%ct%x09%s']),
  ]);
  if (counts.ok) [row.behind, row.ahead] = counts.out.split(/\s+/).map(Number);
  if (status.ok && status.out) row.dirty = status.out.split('\n').length;
  if (last.ok && last.out) {
    const [ts, ...subject] = last.out.split('\t');
    row.lastCommit = { ts: Number(ts) * 1000, subject: subject.join('\t') };
  }
  const files = new Set();
  if (mb.ok) {
    // Against the merge base and the working tree, so committed and uncommitted work both count.
    const numstat = await git(cwd, ['diff', '--numstat', mb.out]);
    if (numstat.ok && numstat.out) {
      for (const line of numstat.out.split('\n')) {
        const [a, d, file] = line.split('\t');
        if (!file) continue;
        files.add(file.includes(' => ') ? file.replace(/\{(.*) => (.*)\}/, '$2').replace(/.* => /, '') : file);
        row.add += Number(a) || 0;
        row.del += Number(d) || 0;
      }
    }
  }
  if (status.ok && status.out) {
    for (const line of status.out.split('\n')) if (line.startsWith('??')) files.add(line.slice(3));
  }
  row.files = [...files];
  if (row.ahead > 0 && row.behind > 0) {
    const merge = await git(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base.ref, 'HEAD']);
    // Exit 1 means conflicts: the first line is the tree, the rest the conflicted paths.
    if (!merge.ok && merge.code === 1) row.conflicts = merge.out.split('\n').slice(1).filter(Boolean);
  }
  return row;
}

// Whether a commit has reached the base branch, so a queued merge can be marked landed.
export async function landed(root, commit, base) {
  const b = await baseRef(root, base);
  return (await git(root, ['merge-base', '--is-ancestor', commit, b.ref])).ok;
}

// The worktree that holds a path (the deepest one containing it).
export async function worktreeOf(root, dir) {
  const list = await listWorktrees(root);
  const abs = path.resolve(dir);
  return list.filter((wt) => abs === wt.path || abs.startsWith(wt.path + path.sep)).sort((a, b) => b.path.length - a.path.length)[0] || null;
}
