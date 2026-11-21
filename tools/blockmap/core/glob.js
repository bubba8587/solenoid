// Path patterns for blocks. Runs in Node and the browser.
//
// A block owns paths through glob patterns: `**` crosses folders, `*` and `?` stay inside one,
// `{a,b}` lists alternatives (expanded before matching, so each one keeps its own specificity),
// a trailing `/` means the whole folder, and a pattern with no `/` matches a file name anywhere.
// Matching ignores case. When several blocks claim a path, the most specific pattern wins: an
// exact path beats any wildcard, and a longer literal part beats a shorter one.

export function expandBraces(pattern) {
  const open = pattern.indexOf('{');
  if (open < 0) return [pattern];
  let depth = 0;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === '{') depth++;
    else if (pattern[i] === '}' && --depth === 0) {
      const head = pattern.slice(0, open);
      const tail = pattern.slice(i + 1);
      const parts = splitTop(pattern.slice(open + 1, i));
      return parts.flatMap((p) => expandBraces(head + p + tail));
    }
  }
  return [pattern];
}

function splitTop(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const SPECIAL = /[.+^$()|[\]\\]/g;

export function globToRegExp(glob) {
  let g = glob.trim().replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  const anywhere = !g.includes('/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        const slashAfter = g[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(SPECIAL, '\\$&');
  }
  return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${re}$`, 'i');
}

export function specificity(glob) {
  const g = glob.trim();
  const wild = (g.match(/\*|\?/g) || []).length;
  const literal = g.replace(/\*|\?/g, '').length;
  if (wild === 0 && !g.endsWith('/')) return 10000 + literal;
  const doubleStars = (g.match(/\*\*/g) || []).length;
  return literal * 4 - wild * 3 - doubleStars * 6 + (g.includes('/') ? 0 : -40);
}

// One compiled entry per expanded pattern, most specific first.
export function compileIndex(blocks) {
  const entries = [];
  for (const block of blocks) {
    for (const raw of block.paths || []) {
      for (const pattern of expandBraces(raw)) {
        entries.push({ block: block.id, pattern, re: globToRegExp(pattern), spec: specificity(pattern) });
      }
    }
  }
  entries.sort((a, b) => b.spec - a.spec);
  // A fold asks for the same few paths over and over; each answer is kept on the index it came from.
  Object.defineProperty(entries, 'memo', { value: new Map() });
  return entries;
}

// The compiled index for a board's blocks, compiled once per blocks list (and again if its ids or paths
// change), so folds and replays of one board share it and its memo.
const compiled = new WeakMap();
export function indexFor(blocks) {
  const sig = blocks.map((b) => `${b.id}\u0000${(b.paths || []).join('\u0000')}`).join('\u0001');
  const hit = compiled.get(blocks);
  if (hit && hit.sig === sig) return hit.index;
  const index = compileIndex(blocks);
  compiled.set(blocks, { sig, index });
  return index;
}

export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

export function blockForPath(index, path) {
  const p = normalizePath(path);
  const memo = index.memo;
  const known = memo?.get(p);
  if (known !== undefined) return known;
  let block = null;
  for (const e of index) {
    if (e.re.test(p)) {
      block = e.block;
      break;
    }
  }
  if (memo) {
    if (memo.size >= 100_000) memo.clear();
    memo.set(p, block);
  }
  return block;
}

export function matchDetail(index, path) {
  const p = normalizePath(path);
  for (const e of index) if (e.re.test(p)) return { block: e.block, pattern: e.pattern };
  return null;
}
