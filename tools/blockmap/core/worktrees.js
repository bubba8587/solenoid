// Every worktree of the repository as git sees it: its branch, how far it is ahead of and behind the base
// branch, the files and lines it changed since it branched (uncommitted work included), and the files that
// would conflict if it merged now (a dry-run merge, `git merge-tree`, which touches nothing). Node only.
//
// Nothing here needs the agent's cooperation, which is what makes the board work with any agent on any
// model: whatever edits files in a worktree shows up.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { safeId } from './model.js';

// Every call reads without taking the optional index lock, so a poll every few seconds never makes an agent's
// own `git add` or `git commit` fail on index.lock. `raw` keeps the output as git wrote it (NUL-separated -z).
function git(cwd, args, { raw = false } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['--no-optional-locks', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      const out = String(stdout || '');
      resolve({ ok: !err, code: err ? err.code ?? 1 : 0, out: raw ? out : out.trim() });
    });
  });
}

// `git status --porcelain -z`: "XY path", NUL-ended, and a rename or copy's source path as the next field.
export function parseStatus(out) {
  const parts = out.split('\0');
  const rows = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const code = p.slice(0, 2);
    rows.push({ code, path: p.slice(3) });
    if (/[RC]/.test(code)) i++;
  }
  return rows;
}

// `git diff --numstat -z`: "added TAB deleted TAB path", NUL-ended; a rename leaves the path empty and gives the
// source and the destination as the next two fields. Binary files count "-" lines.
export function parseNumstat(out) {
  const parts = out.split('\0');
  const rows = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t([^]*)$/.exec(parts[i]);
    if (!m) continue;
    let file = m[3];
    if (!file) {
      file = parts[i + 2] || '';
      i += 2;
    }
    if (file) rows.push({ add: Number(m[1]) || 0, del: Number(m[2]) || 0, file });
  }
  return rows;
}

// The paths a dry-run `git merge-tree --write-tree --name-only -z` says conflict: the fields after the tree.
function conflictsOf(res) {
  return !res.ok && res.code === 1 ? res.out.split('\0').slice(1).filter(Boolean) : [];
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

// A worktree is named after its folder, made into an id the log accepts.
export function worktreeName(wt) {
  return wt.main ? 'main' : safeId(path.basename(wt.path));
}

export async function worktreeSnapshot(root, { base } = {}) {
  const list = await listWorktrees(root);
  const b = await baseRef(root, base);
  const rows = await Promise.all(list.filter((wt) => !wt.bare && !wt.prunable && fs.existsSync(wt.path)).map((wt) => inspect(wt, b)));
  return { base: b.name, at: Date.now(), list: rows, clashes: await forecast(root, rows) };
}

// The merge forecast: for each pair of branches that changed a file in common, a dry-run merge of the two
// heads says which files would really conflict once one of them has landed. Overlaps that merge cleanly are
// not clashes. Results are kept per pair of commits, so a pair is merged again only when a branch moves.
const forecastCache = new Map();
export async function forecast(root, rows) {
  const branches = rows.filter((r) => !r.main && r.head && r.ahead > 0);
  const sets = branches.map((r) => new Set(r.files));
  const out = [];
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const a = branches[i];
      const b = branches[j];
      const [small, big] = sets[i].size <= sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
      let shared = false;
      for (const f of small) {
        if (big.has(f)) {
          shared = true;
          break;
        }
      }
      if (!shared) continue;
      const key = `${a.head}|${b.head}`;
      if (!forecastCache.has(key)) {
        const res = await git(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', a.head, b.head], { raw: true });
        forecastCache.set(key, conflictsOf(res));
        if (forecastCache.size > 500) forecastCache.delete(forecastCache.keys().next().value);
      }
      const files = forecastCache.get(key);
      if (files.length) out.push({ a: a.name, b: b.name, files });
    }
  }
  return out;
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
    git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all'], { raw: true }),
    git(cwd, ['log', '-1', '--format=%ct%x09%s']),
  ]);
  if (counts.ok) [row.behind, row.ahead] = counts.out.split(/\s+/).map(Number);
  const entries = status.ok ? parseStatus(status.out) : [];
  row.dirty = entries.length;
  if (last.ok && last.out) {
    const [ts, ...subject] = last.out.split('\t');
    row.lastCommit = { ts: Number(ts) * 1000, subject: subject.join('\t') };
  }
  const files = new Set();
  if (mb.ok) {
    // Against the merge base and the working tree, so committed and uncommitted work both count.
    const numstat = await git(cwd, ['diff', '--numstat', '-z', mb.out], { raw: true });
    if (numstat.ok) {
      for (const r of parseNumstat(numstat.out)) {
        files.add(r.file);
        row.add += r.add;
        row.del += r.del;
      }
    }
  }
  for (const e of entries) if (e.code === '??') files.add(e.path);
  row.files = [...files];
  if (row.ahead > 0 && row.behind > 0) {
    // Exit 1 means conflicts: the first field is the tree, the rest the conflicted paths.
    row.conflicts = conflictsOf(await git(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', base.ref, 'HEAD'], { raw: true }));
  }
  return row;
}

// The files that differ between two commits, or null when git can't say (a commit that is gone).
export async function changedBetween(cwd, a, b) {
  const res = await git(cwd, ['diff', '--name-only', '-z', a, b], { raw: true });
  return res.ok ? new Set(res.out.split('\0').filter(Boolean)) : null;
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
