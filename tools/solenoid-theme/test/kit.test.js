// The kit is Solenoid's palette system: the generated files match Solenoid's sources, and the system behaves the
// way its spec says on any page (tree/specs/canvas/palette-and-theme.md).
//
//   node --test tools/solenoid-theme/test/kit.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  PALETTE, PALETTE_NAMES, COLOR_PALETTE, BUILTIN_CHROME, CHROME_HOME, CHROME_VARS, paletteStore, adaptChrome, contrastInk,
  themeVars, appThemeStore, slotVars, SOLENOID_SLOT_ROLES,
} from '../index.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the generated files match Solenoid', () => {
  const res = spawnSync(process.execPath, [path.join(KIT, 'sync.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});

const valid = (v) => v === null || /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgba?\(/.test(v) || /^-?\d+(px)? /.test(v);

test('every palette, mode and accent writes well-formed variables', () => {
  for (const name of [...PALETTE_NAMES, 'Custom']) {
    paletteStore.setActiveBase(name);
    for (const mode of ['dark', 'light']) {
      for (const accent of COLOR_PALETTE) {
        const vars = themeVars(accent, mode);
        for (const [k, v] of Object.entries(vars)) assert.ok(valid(v), `${name} ${mode} ${accent}: ${k} = ${v}`);
        assert.match(vars['--accent'], /^#[0-9a-f]{6}$/i);
        assert.ok(['#fff', '#1a1a1a'].includes(vars['--accent-ink']));
      }
    }
  }
  paletteStore.setActiveBase('Default');
});

test('Default leaves the workbench to theme.css; the others write their whole ramp', () => {
  paletteStore.setActiveBase('Default');
  const def = themeVars('gold', 'dark');
  for (const { var: v } of CHROME_VARS) assert.equal(def[v], null, v);
  paletteStore.setActiveBase('Solarized');
  const sol = themeVars('gold', 'dark');
  for (const { var: v } of CHROME_VARS) assert.match(sol[v], /^#[0-9a-f]{6}$/i, v);
  paletteStore.setActiveBase('Default');
});

test('a tinted ramp follows the accent, and stays authored at home', () => {
  for (const [name, home] of Object.entries(CHROME_HOME)) {
    const ramp = BUILTIN_CHROME[name].dark;
    paletteStore.setActiveBase(name);
    const at = paletteStore.chromeHomeHex();
    assert.ok(at && home in PALETTE, `${name} names a home slot`);
    assert.equal(adaptChrome(ramp, at, at), ramp, `${name} at its home accent`);
    const turned = adaptChrome(ramp, at, '#e0473a');
    assert.notEqual(turned.surface, ramp.surface, `${name} under vermilion`);
  }
  paletteStore.setActiveBase('Default');
});

test('ink is white or near-black by the 3:1 rule', () => {
  assert.equal(contrastInk('#000000'), '#fff');
  assert.equal(contrastInk('#ffffff'), '#1a1a1a');
  assert.equal(contrastInk('#f5b914'), '#1a1a1a');
  assert.equal(contrastInk('nonsense'), '#fff');
});

test('every slot becomes a CSS variable with its ink', () => {
  const vars = slotVars('light');
  assert.equal(Object.keys(vars).length, Object.keys(PALETTE).length * 2);
  for (const slot of Object.keys(PALETTE)) {
    assert.match(vars[`--slot-${slot}`], /^#[0-9a-f]{6}$/i);
    assert.ok(['#fff', '#1a1a1a'].includes(vars[`--slot-${slot}-ink`]));
  }
  assert.equal(appThemeStore.getAccent(), 'gold');
  assert.deepEqual(new Set(SOLENOID_SLOT_ROLES.map((r) => r.slot)), new Set(Object.keys(PALETTE)));
});
