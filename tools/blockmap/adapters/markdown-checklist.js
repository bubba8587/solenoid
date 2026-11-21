// Imports a markdown checklist (`- [ ] **Title** detail…` under `## Heading`s) as board items.
// Runs in Node and the browser.
//
// The source config routes each heading to a block (`route`: heading substring → block id, or
// "auto" to route by the blocks' keywords), sets an item's kind from its heading (`kinds`), and
// names a fallback block (`default`). Item ids hash the heading and title, so an item keeps its id
// while the file around it changes.

import { hash } from '../core/model.js';

export function importChecklist(text, src, board) {
  const lines = text.split('\n');
  const items = [];
  let heading = '';
  let cur = null;
  const flush = () => {
    if (!cur) return;
    items.push(finish(cur, src, board));
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1].trim();
      continue;
    }
    const m = /^[-*]\s+\[ \]\s+(.*)$/.exec(line);
    if (m) {
      flush();
      cur = { heading, text: m[1], line: i + 1 };
      continue;
    }
    if (cur && /^\s{2,}\S/.test(line) && !/^\s*[-*]\s+\[[ x]\]/.test(line)) cur.text += ` ${line.trim()}`;
    else if (cur && (!line.trim() || /^\S/.test(line))) flush();
  }
  flush();
  return items;
}

function finish(cur, src, board) {
  const bold = /^\*\*(.+?)\*\*[.:]?\s*(.*)$/.exec(cur.text);
  let title;
  let detail;
  if (bold) {
    title = bold[1];
    detail = bold[2];
  } else {
    const cut = cur.text.search(/[.;:](\s|$)/);
    title = cut > 10 && cut < 140 ? cur.text.slice(0, cut) : cur.text.slice(0, 120);
    detail = cur.text.slice(title.length).replace(/^[.;:]\s*/, '');
  }
  title = plain(title).slice(0, 160);
  detail = plain(detail);
  if (detail.length > 900) detail = `${detail.slice(0, 900)}…`;
  const kind = kindFor(cur.heading, cur.text, src);
  const block = routeFor(cur.heading, title, detail, src, board);
  const sourceTag = src.prefix || 'L';
  return {
    id: `${sourceTag}-${hash(`${cur.heading}|${title}`).toString(36).slice(0, 5)}`,
    kind,
    title,
    detail,
    block,
    status: 'open',
    source: 'import',
    group: plain(cur.heading),
    ref: `${src.file}:${cur.line}`,
  };
}

function plain(s) {
  return s
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function kindFor(heading, text, src) {
  const hay = `${heading} ${text.slice(0, 80)}`.toLowerCase();
  for (const rule of src.kinds || []) {
    const re = new RegExp(`(^|[^a-z])${rule.match.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z]|$)`);
    if (re.test(hay)) return rule.kind;
  }
  if (/^\*{0,2}(bug|fix)\b/i.test(text)) return 'bug';
  return src.kind || 'task';
}

function routeFor(heading, title, detail, src, board) {
  const hay = heading.toLowerCase();
  let target = null;
  for (const [match, id] of Object.entries(src.route || {})) {
    if (hay.includes(match.toLowerCase())) {
      target = id;
      break;
    }
  }
  if (target && target !== 'auto') return target;
  return byKeywords(`${title} ${detail}`, board, title) || src.default || null;
}

// The block whose keywords the text names most, counting whole words only and a title's words
// three times over the detail's.
export function byKeywords(text, board, title = '') {
  const head = (title || text.slice(0, 160)).toLowerCase();
  const body = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const b of board.blocks) {
    let score = 0;
    for (const k of b.keywords || []) {
      const re = new RegExp(`(^|[^a-z0-9])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z0-9]|$)`, 'g');
      const weight = k.length > 6 ? 2 : 1;
      score += weight * ((head.match(re) || []).length * 3 + (body.match(re) || []).length);
    }
    if (score > bestScore) {
      best = b.id;
      bestScore = score;
    }
  }
  return best;
}
