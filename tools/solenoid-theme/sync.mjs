#!/usr/bin/env node
// Regenerates the kit's palette code and stylesheets from Solenoid's own sources, so the kit is Solenoid's
// palette system and never a copy that drifts from it:
//
//   core/*.js       src/graph/{palette,storeKit,colormaps,themeVars,appTheme}.ts with the types stripped
//                   (node:module stripTypeScriptTypes), byte for byte otherwise
//   theme.css       App.css's two :root token blocks, and errorChip.css's status fallbacks
//   controls.css    AppToolbar.css, SwatchGrid.css, PaletteEditor.css, the Settings.css rules the Appearance
//                   dialog uses, and mobile.css's rules for the toolbar pill
//
// It then copies the kit's runtime files into each vendor folder (VENDOR below). `--check` writes nothing and
// fails when anything it would write differs, for CI and for a test.
//
//   node tools/solenoid-theme/sync.mjs            regenerate
//   node tools/solenoid-theme/sync.mjs --check    verify
//   SOLENOID_ROOT=/path/to/solenoid node sync.mjs   from a checkout elsewhere (the kit in its own repository)

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.SOLENOID_ROOT || path.join(KIT, '..', '..'));
const CHECK = process.argv.includes('--check');

const TS = ['palette', 'storeKit', 'colormaps', 'themeVars', 'appTheme'];
// Kit folders that carry a copy of the runtime, relative to the repository root.
const VENDOR = ['tools/blockmap/ui/theme'];
const RUNTIME = ['core/palette.js', 'core/storeKit.js', 'core/colormaps.js', 'core/themeVars.js', 'core/appTheme.js', 'core/nativeAccent.js', 'theme.css', 'controls.css', 'kit.css', 'controls.js', 'index.js'];

// The Settings.css classes the Appearance dialog uses; a rule is kept when every class it names is one of these.
const SETTINGS_CLASSES = new Set([
  'solenoid-settings', 'solenoid-settings__panel', 'solenoid-settings__header', 'solenoid-settings__title', 'solenoid-settings__close',
  'solenoid-settings__body', 'solenoid-settings__section', 'solenoid-settings__section-title', 'solenoid-settings__row',
  'solenoid-settings__row-text', 'solenoid-settings__row-label', 'solenoid-settings__row-help', 'solenoid-settings__row--palette',
  'solenoid-settings__palette-control', 'solenoid-settings__palette-row', 'solenoid-settings__palette-edit',
  'solenoid-settings__select-wrap', 'solenoid-settings__select', 'solenoid-settings__select-caret',
  'solenoid-settings__switch', 'solenoid-settings__switch--on', 'solenoid-settings__knob',
]);

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const banner = (from, text, c = '//') =>
  c === '//'
    ? `// GENERATED from ${from} (${sha(text)}) by tools/solenoid-theme/sync.mjs. Edit the source in Solenoid, then sync.\n`
    : `/* GENERATED from ${from} by tools/solenoid-theme/sync.mjs. Edit the source in Solenoid, then sync. */\n`;

function generate() {
  const out = new Map();
  for (const name of TS) {
    const rel = `src/graph/${name}.ts`;
    const src = read(rel);
    const js = stripTypeScriptTypes(src, { mode: 'strip' })
      .replace(/from "\.\/(\w+)"/g, 'from "./$1.js"')
      .replace(/[ \t]+$/gm, '');
    out.set(`core/${name}.js`, banner(rel, src) + js);
  }

  const app = read('src/App.css');
  const rootAt = app.indexOf(':root {');
  const lightAt = app.indexOf(':root[data-theme="light"]');
  if (rootAt < 0 || lightAt < 0) throw new Error('App.css: the two :root token blocks moved; update sync.mjs.');
  const tokens = app.slice(rootAt, blockEnd(app, lightAt));
  const status = read('src/graph/components/errorChip.css');
  const statusRoot = status.slice(status.indexOf(':root {'), blockEnd(status, status.indexOf(':root {')));
  out.set('theme.css', `${banner('src/App.css and errorChip.css', app, '/*')}\n${tokens}\n\n${statusRoot}\n`);

  const parts = [banner('AppToolbar.css, SwatchGrid.css, PaletteEditor.css, Settings.css and mobile.css', '', '/*')];
  for (const rel of ['src/graph/AppToolbar.css', 'src/graph/components/SwatchGrid.css', 'src/graph/components/PaletteEditor.css']) {
    parts.push(`\n/* ${rel} */\n${read(rel).trim()}\n`);
  }
  parts.push(`\n/* src/graph/Settings.css: the Appearance dialog's rules */\n${keepRules(read('src/graph/Settings.css'), SETTINGS_CLASSES)}\n`);
  parts.push(`\n/* src/mobile.css: the toolbar pill on a phone (html.is-mobile, see controls.js markDevice) */\nhtml.is-mobile {\n${phoneRules(read('src/mobile.css')).join('\n')}\n}\n`);
  out.set('controls.css', parts.join(''));
  return out;
}

// The pill's rules in mobile.css: in each `html.is-mobile { … }` block (top level or under an @media), the rules
// whose selector lists name the pill, keeping only those selectors, under the @media they sit in.
function phoneRules(css) {
  const out = [];
  const PILL = /^\.solenoid-apptools[\w-]*(\s+\.solenoid-apptools[\w-]*)*$/;
  const fromBlock = (body, indent) => {
    for (const { head, inner } of rules(body)) {
      const keep = head.split(',').map((x) => x.trim()).filter((x) => PILL.test(x));
      if (keep.length) out.push(`${indent}${keep.join(', ')} { ${inner.trim().replace(/\s*\n\s*/g, ' ')} }`);
    }
  };
  for (const { head, inner } of rules(css)) {
    if (head === 'html.is-mobile') fromBlock(inner, '  ');
    else if (head.startsWith('@media')) {
      const at = out.length;
      for (const r of rules(inner)) if (r.head === 'html.is-mobile') fromBlock(r.inner, '    ');
      if (out.length > at) out.splice(at, 0, `  ${head} {`), out.push('  }');
    }
  }
  return out;
}

// The top-level rules of a stylesheet (or of a block's body): selector or at-rule, and what is inside the braces.
function rules(css) {
  const list = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const end = blockEnd(text, open);
    const head = text.slice(i, open).split(/[;}]/).pop().trim();
    list.push({ head, inner: text.slice(open + 1, end - 1) });
    i = end;
  }
  return list;
}

// The index just past the closing brace of the block that opens at or after `from`.
function blockEnd(text, from) {
  let depth = 0;
  for (let i = text.indexOf('{', from); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i + 1;
  }
  throw new Error('unbalanced braces');
}

// Top-level rules whose selectors name only allowed classes; comments directly above a kept rule stay with it.
function keepRules(css, allowed) {
  const kept = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const end = blockEnd(css, open);
    const head = css.slice(i, open);
    const selector = head.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const classes = selector.match(/\.[\w-]+/g) || [];
    if (!selector.startsWith('@') && classes.length && classes.every((c) => allowed.has(c.slice(1)))) kept.push(css.slice(i, end).trim());
    i = end;
  }
  return kept.join('\n\n');
}

const generated = generate();
const runtime = new Map();
for (const rel of RUNTIME) runtime.set(rel, generated.get(rel) ?? fs.readFileSync(path.join(KIT, rel), 'utf8'));

const writes = [...generated].map(([rel, text]) => [path.join(KIT, rel), text]);
for (const dir of VENDOR) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(path.dirname(base))) continue;
  for (const [rel, text] of runtime) writes.push([path.join(base, rel), text]);
  writes.push([path.join(base, 'README.md'), `A vendored copy of tools/solenoid-theme (Solenoid's palette system). Generated: edit the kit, then\n\`node tools/solenoid-theme/sync.mjs\`.\n`]);
}

const stale = [];
for (const [file, text] of writes) {
  const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (now === text) continue;
  stale.push(path.relative(ROOT, file));
  if (!CHECK) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}
if (CHECK) {
  if (stale.length) {
    console.error(`solenoid-theme is out of date with Solenoid (run node tools/solenoid-theme/sync.mjs):\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log('solenoid-theme matches Solenoid.');
} else console.log(stale.length ? `wrote ${stale.length} files:\n  ${stale.join('\n  ')}` : 'up to date');
