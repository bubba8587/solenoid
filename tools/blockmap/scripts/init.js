// `bm init`: a first board for any git repository, drawn from its folders. Each top-level folder
// becomes a district; a folder becomes a block once it holds few enough files, so a big folder
// splits into its subfolders. The result is a starting point to rename, merge and regroup by hand.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitFiles } from '../core/files.js';

const MAX_FILES = 90;

export function initBoard(cwd, { name } = {}) {
  let root = cwd;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // Not a git checkout: the board covers this folder.
  }
  const dir = path.join(root, '.blockmap');
  const file = path.join(dir, 'board.json');
  if (fs.existsSync(file)) return { message: `${path.relative(cwd, file) || file} already exists; edit it by hand.` };
  const board = draftBoard(gitFiles(root), name || path.basename(root));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(board, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'live/\n');
  return {
    message: `Wrote ${path.relative(cwd, file)}: ${board.districts.length} districts, ${board.blocks.length} blocks. Rename and regroup them so each block is a piece of work one agent can own, then \`bm serve --open\`.`,
  };
}

export function draftBoard(files, name) {
  const blocks = [];
  const districts = [];
  const used = new Set();
  function uniqueId(base) {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  }
  const byTop = new Map();
  for (const f of files) {
    const top = f.includes('/') ? f.split('/')[0] : '(root)';
    if (!byTop.has(top)) byTop.set(top, []);
    byTop.get(top).push(f);
  }
  const tops = [...byTop.entries()].sort((a, b) => b[1].length - a[1].length);
  tops.forEach(([top, list]) => {
    const district = slug(top === '(root)' ? 'root' : top);
    districts.push({ id: district, name: top === '(root)' ? 'Top level' : title(top) });
    if (top === '(root)') {
      blocks.push({ id: 'root-files', name: 'Top-level files', district, about: '', paths: list.map((f) => f), docs: [], keywords: [] });
      return;
    }
    split(top, list, 1, district);
  });

  function split(prefix, list, depth, district) {
    const flat = list.every((f) => !f.slice(prefix.length + 1).includes('/'));
    if (list.length <= MAX_FILES || depth >= 4 || flat) {
      blocks.push(block(prefix, district));
      return;
    }
    const groups = new Map();
    const loose = [];
    for (const f of list) {
      const rest = f.slice(prefix.length + 1);
      if (!rest.includes('/')) loose.push(f);
      else {
        const sub = `${prefix}/${rest.split('/')[0]}`;
        if (!groups.has(sub)) groups.set(sub, []);
        groups.get(sub).push(f);
      }
    }
    for (const [sub, subList] of groups) split(sub, subList, depth + 1, district);
    if (loose.length) blocks.push({ ...block(prefix, district), id: uniqueId(`${slug(prefix)}-files`), name: `${title(prefix.split('/').pop())} (files)`, paths: [`${prefix}/*`] });
  }

  function block(prefix, district) {
    const parts = prefix.split('/');
    return { id: uniqueId(slug(parts.slice(-2).join('-'))), name: title(parts[parts.length - 1]), district, about: `Everything under ${prefix}/.`, paths: [`${prefix}/`], docs: [], keywords: [parts[parts.length - 1].toLowerCase()] };
  }

  return { schema: 1, name, human: { name: 'You' }, staleAfterMin: 30, guard: { held: 'deny', frozen: 'deny', free: 'reserve' }, districts, blocks, sources: [] };
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block';
}

function title(s) {
  const t = s.replace(/[-_.]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
