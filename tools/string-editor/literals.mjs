// Source-literal engine: scan src/**/*.{ts,tsx,md} for string literals + md text,
// index them by decoded content, and safely rewrite a single literal's content.
//
// The hard part is escaping: we match the FULL quoted literal (quote+body+quote),
// decode the body to compare against the on-screen text, and on save we re-encode
// the new text into the SAME quote style so quoting/escaping never breaks.

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
// Durable, append-only record of successful copy/voice edits (tracked in git).
const COPY_LOG = path.join(HERE, 'copy-edits.jsonl');

// ---- escape decode / encode -------------------------------------------------

// Decode a JS/TS string-literal body (no surrounding quotes) to its runtime value.
function decodeBody(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out += c; continue; }
    const n = body[++i];
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case 'x': {
        const hex = body.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 2; }
        else out += n;
        break;
      }
      case 'u': {
        if (body[i + 1] === '{') {
          const end = body.indexOf('}', i);
          const hex = body.slice(i + 2, end);
          if (end > 0 && /^[0-9a-fA-F]+$/.test(hex)) { out += String.fromCodePoint(parseInt(hex, 16)); i = end; }
          else out += n;
        } else {
          const hex = body.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; }
          else out += n;
        }
        break;
      }
      case '\n': break; // line continuation
      default: out += n; // \\  \'  \"  \`  \$  \/ etc -> literal char
    }
  }
  return out;
}

// Encode runtime text into a literal body for the given quote char.
export function encodeBody(text, quote) {
  let out = '';
  for (const ch of text) {
    if (ch === '\\') { out += '\\\\'; continue; }
    if (ch === quote) { out += '\\' + ch; continue; }
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') { out += '\\r'; continue; }
    if (ch === '\t') { out += '\\t'; continue; }
    if (quote === '`' && ch === '$') { out += '\\$'; continue; } // guard ${ interpolation
    out += ch;
  }
  return out;
}

export function rebuildLiteral(text, quote) {
  return quote + encodeBody(text, quote) + quote;
}

// ---- literal scanner --------------------------------------------------------

// Walk a TS/TSX source and emit every simple string literal.
// Skips comments; template literals containing ${ are flagged hasInterp and not editable.
// A real parser finds the literals, so regex literals, JSX text and nested templates can't throw the scan out of
// step the way a quote-by-quote walk did. A file that won't parse yields none.
function scanSource(text, file = 'x.tsx') {
  let ast;
  try {
    ast = parse(text, { sourceType: 'module', errorRecovery: true, plugins: file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] });
  } catch { return []; }
  const out = [];
  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    const plain = node.type === 'StringLiteral' || (node.type === 'TemplateLiteral' && node.expressions.length === 0);
    if (plain || node.type === 'TemplateLiteral') {
      const raw = text.slice(node.start, node.end);
      out.push({
        start: node.start, end: node.end, line: node.loc.start.line, quote: raw[0],
        raw, hasInterp: !plain, content: plain ? decodeBody(raw.slice(1, -1)) : null,
      });
      if (plain) return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') visit(v);
    }
  };
  visit(ast.program);
  out.sort((x, y) => x.start - y.start);
  return out;
}

// ---- index ------------------------------------------------------------------

// Build an index over all source files. Returns { byContent, mdFiles, fileCount }.
export async function buildIndex(listFiles) {
  const files = await listFiles(); // array of absolute paths
  const byContent = new Map(); // decoded content -> [{file, ...record}]
  const mdFiles = []; // { file, text }
  for (const abs of files) {
    let text;
    try { text = await readFile(abs, 'utf8'); } catch { continue; }
    const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
    if (abs.endsWith('.md')) {
      mdFiles.push({ file: rel, abs, text });
      continue;
    }
    for (const lit of scanSource(text, abs)) {
      if (lit.hasInterp || lit.content === null || lit.content === '') continue;
      const rec = { file: rel, abs, start: lit.start, end: lit.end, line: lit.line, quote: lit.quote, raw: lit.raw, content: lit.content };
      const arr = byContent.get(lit.content);
      if (arr) arr.push(rec); else byContent.set(lit.content, [rec]);
    }
  }
  return { byContent, mdFiles, fileCount: files.length };
}

// Find source matches for one on-screen string.
export function findMatches(index, s) {
  const matches = [];
  const lit = index.byContent.get(s);
  if (lit) for (const r of lit) matches.push({ kind: 'literal', file: r.file, abs: r.abs, line: r.line, start: r.start, end: r.end, quote: r.quote, raw: r.raw });
  if (matches.length === 0) {
    // md substring search
    for (const m of index.mdFiles) {
      let idx = m.text.indexOf(s);
      while (idx !== -1) {
        const line = m.text.slice(0, idx).split('\n').length;
        matches.push({ kind: 'md', file: m.file, abs: m.abs, line, start: idx, end: idx + s.length, quote: null, raw: s });
        idx = m.text.indexOf(s, idx + s.length);
        if (matches.length > 20) break; // cap noise
      }
    }
  }
  return matches;
}

// ---- write-back -------------------------------------------------------------

// Replace one match's content in its file. Verifies the region still holds the
// expected raw; falls back to a unique search if offsets drifted (HMR edits).
export async function applyEdit({ abs, start, end, quote, raw, kind, newText, fromText, status, context }) {
  const text = await readFile(abs, 'utf8');
  const replacement = kind === 'md' ? newText : rebuildLiteral(newText, quote);

  let s = start, e = end;
  if (text.slice(s, e) !== raw) {
    // offsets drifted: require a UNIQUE occurrence of raw to be safe
    const first = text.indexOf(raw);
    if (first === -1) throw new Error('original text no longer found in file (it may have changed)');
    const second = text.indexOf(raw, first + raw.length);
    if (second !== -1) throw new Error('original text is no longer at a unique position; rescan and retry');
    s = first; e = first + raw.length;
  }
  const next = text.slice(0, s) + replacement + text.slice(e);
  await writeFile(abs, next, 'utf8');

  const relFile = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
  const line = text.slice(0, s).split('\n').length;
  // Durable record of the copy/voice edit. Best-effort: never fail the edit over it.
  await logCopyEdit({
    file: relFile,
    line,
    from: fromText ?? (kind === 'md' ? raw : decodeBody(raw.slice(1, -1))),
    to: newText,
    ...(context ? { context } : {}),
    ...(status ? { status } : {}),
  });

  return { file: relFile, from: raw, to: replacement };
}

// Append one edit record to copy-edits.jsonl (created lazily on first write).
async function logCopyEdit({ file, line, from, to, context, status }) {
  try {
    const rec = { ts: new Date().toISOString(), file, line, from, to };
    if (context) rec.context = context;
    if (status) rec.status = status;
    await appendFile(COPY_LOG, JSON.stringify(rec) + '\n', 'utf8');
  } catch {
    // logging must never break a successful source rewrite
  }
}

export { scanSource, decodeBody };
