// The board as the UI and the CLI see it: the committed config plus what it derives from the
// repository (items imported from a markdown checklist, each block's files). Node only.

import fs from 'node:fs';
import path from 'node:path';
import { compileIndex, blockForPath } from './glob.js';
import { importChecklist } from '../adapters/markdown-checklist.js';
import { gitFiles } from './files.js';

export function resolveBoard(store, { items = true, files = false, samples = 0 } = {}) {
  const config = store.readConfig();
  const board = {
    schema: config.schema ?? 1,
    name: config.name || path.basename(store.root),
    human: config.human || { name: 'You' },
    staleAfterMin: config.staleAfterMin ?? 30,
    guard: config.guard || {},
    districts: config.districts || [],
    blocks: (config.blocks || []).map((b) => ({ ...b })),
    items: [],
    sources: config.sources || [],
  };
  if (items) {
    for (const src of board.sources) {
      if (src.type !== 'markdown-checklist') continue;
      try {
        const text = fs.readFileSync(path.join(store.root, src.file), 'utf8');
        board.items.push(...importChecklist(text, src, board));
      } catch {
        // A source that went missing imports nothing; the board still loads.
      }
    }
  }
  if (files) countFiles(store.root, board, samples);
  return board;
}

export function countFiles(root, board, samples = 0) {
  const list = gitFiles(root);
  const index = compileIndex(board.blocks);
  const byId = Object.fromEntries(board.blocks.map((b) => [b.id, b]));
  for (const b of board.blocks) {
    b.files = 0;
    b.kb = 0;
    if (samples) b.sample = [];
  }
  const unmapped = { files: 0, kb: 0, sample: [] };
  for (const f of list) {
    const id = blockForPath(index, f);
    let size = 0;
    try {
      size = fs.statSync(path.join(root, f)).size;
    } catch {
      continue;
    }
    const target = id ? byId[id] : unmapped;
    target.files++;
    target.kb += size / 1024;
    if (target.sample && target.sample.length < Math.max(samples, id ? 0 : 40)) target.sample.push(f);
  }
  for (const b of board.blocks) b.kb = Math.round(b.kb);
  unmapped.kb = Math.round(unmapped.kb);
  board.unmapped = unmapped;
  board.totalFiles = list.length;
  return board;
}
