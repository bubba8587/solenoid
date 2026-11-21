// A browser smoke test of the board: boots a demo server on a free port, drives the page the way a person
// would, and fails on any console error. Needs Playwright with a Chromium (not a dependency of Blockmap;
// it's found wherever `require('playwright')` resolves, NODE_PATH included).
//
//   node tools/blockmap/scripts/smoke.js

import { createRequire } from 'node:module';
import { serve } from '../server.js';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('smoke: Playwright is not installed here; skipped.');
  process.exit(0);
}

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const server = await serve({ port: 0, demo: true, quiet: true });
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.blockmap?.live && document.querySelectorAll('.win[data-win^="cc-"], .win[data-win^="cx-"], .win[data-win^="gm-"], .win[data-win^="wt-"]').length > 0, null, { timeout: 15_000 });

  const tiles = await page.locator('.tile').count();
  const blocks = await page.evaluate(() => window.blockmap.board.blocks.length);
  check(tiles >= blocks, `a tile per block (${tiles} for ${blocks})`);
  check((await page.locator('.wt-tab').count()) > 1, 'worktree tabs');
  const fits = await page.evaluate(() => {
    const w = document.getElementById('map-wrap');
    return w.scrollHeight <= w.clientHeight + 1 && w.scrollWidth <= w.clientWidth + 1;
  });
  check(fits, 'the whole map fits at 1440x900 without scrolling');
  check((await page.locator('#tethers path').count()) === 0, 'no tethers until you point at an agent');

  // Drag a free tile into an agent's window: the agent holds it.
  const free = await page.evaluate(() => Object.values(window.blockmap.live.blocks).find((b) => !b.holder && !b.queued && !b.frozen && !b.id.startsWith('_'))?.id);
  const agent = await page.evaluate(() => Object.values(window.blockmap.live.agents).find((a) => a.id !== 'human' && !a.leftAt)?.id);
  const from = await page.locator(`.tile[data-block="${free}"]`).boundingBox();
  const to = await page.locator(`.win[data-win="${agent}"]`).boundingBox();
  await page.mouse.move(from.x + 20, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 20, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  check((await page.evaluate((id) => window.blockmap.live.blocks[id].holder, free)) === agent, 'dragging a tile to a window gives the block to that agent');

  // The inspector opens on a block and closes on Escape.
  await page.evaluate((id) => window.blockmap.select(id), free);
  await page.waitForTimeout(350);
  check(await page.locator('.inspector.open').isVisible(), 'the inspector opens');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  check(!(await page.locator('.inspector.open').count()), 'Escape closes it');

  // Focusing a worktree lights its blocks.
  const wt = await page.evaluate(() => window.blockmap.worktrees?.list.find((w) => !w.main && w.files.length)?.name);
  if (wt) {
    await page.click(`.wt-tab[data-wt="${wt}"]`);
    await page.waitForTimeout(300);
    const lit = await page.locator('.map .tile:not(.dim)').count();
    const dim = await page.locator('.map .tile.dim').count();
    check(lit > 0 && dim > 0 && (await page.locator('.wt-detail').isVisible()), `focusing ${wt} lights its blocks (${lit} lit, ${dim} dimmed)`);
    await page.click('.wt-tab[data-wt=""]');
  }

  // The merge queue reorders from the keyboard, and the head gets the act that fits it.
  const ready = await page.locator('.mq-grip').count();
  if (ready > 1) {
    const name = await page.locator('.mq-grip').last().getAttribute('data-name');
    for (let i = 0; i < ready - 1; i++) {
      await page.focus(`.mq-grip[data-name="${name}"]`);
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
    }
    const head = await page.evaluate(() => window.blockmap.mergeRows.find((r) => r.entry.status === 'ready'));
    check(head?.entry.worktree === name, `arrow keys move ${name} to the head of the merge queue`);
    const act = await page.locator('.mq-row').first().locator('.btn').textContent().catch(() => '');
    const want = head.level === 'danger' ? 'Ask to fix' : head.checks.some((c) => c.action === 'rebase') ? 'Rebase' : head.level === 'ok' ? 'Merge' : '';
    check((act || '') === want, `the head's button says ${want || 'nothing'} (${act || 'none'})`);
  }

  // Active only keeps the blocks with something going on.
  await page.click('#active-only');
  await page.waitForTimeout(300);
  const hidden = await page.locator('.slot[hidden]').count();
  check(hidden > 0, `Active hides the quiet blocks (${hidden})`);
  await page.click('#active-only');

  // Scrubbing the timeline replays the past; Live returns.
  const tl = await page.locator('.tl-svg').boundingBox();
  if (tl) {
    await page.mouse.click(tl.x + tl.width * 0.4, tl.y + tl.height / 2);
    await page.waitForTimeout(300);
    check(!!(await page.evaluate(() => window.blockmap.replayTs)), 'scrubbing the timeline replays');
    await page.click('.tl-head button:has-text("Live")');
    check(!(await page.evaluate(() => window.blockmap.replayTs)), 'Live returns');
  }

  // A phone never scrolls sideways.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await phone.goto(url);
  await phone.waitForTimeout(2500);
  const overflow = await phone.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `no sideways scroll on a phone (${overflow}px)`);

  check(!errors.length, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`smoke: ${failures.length} failed`);
  process.exit(1);
}
console.log('smoke: all passed');
process.exit(0);
