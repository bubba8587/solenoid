// Worktrees on the page: a tab strip over the map (all of them, or one in focus, with its path, a cd and an
// editor link for jumping into it) and the merge queue window, with what each queued branch would run into
// and the one act that moves it along.

import { HUMAN, agentName } from '../core/model.js';
import { blocksOf } from '../core/merges.js';
import { icon, setHtml, esc, timer, initials, copyText, storageGet, storageSet } from './dom.js';
import { colorOf, inkOf } from './map.js';
import { ICONS } from './theme/index.js';

const EDITORS = { vscode: ['VS Code', 'vscode://file'], cursor: ['Cursor', 'cursor://file'], zed: ['Zed', 'zed://file'] };
const DOT = { ok: 'dot-ok', info: 'dot-ok', warn: 'dot-warn', danger: 'dot-danger' };

export function createWorktrees(ctx, bar, mergeHost) {
  let editor = storageGet('blockmap.editor', 'vscode');
  let dragging = null;
  let moving = false;

  bar.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-wt]');
    if (tab) {
      ctx.focus(tab.dataset.wt || null);
      return;
    }
    const wt = current();
    if (!wt) return;
    if (e.target.closest('[data-copy-cd]')) copyText(`cd "${wt.path}"`, 'Copied the cd command.');
    else if (e.target.closest('[data-copy-path]')) copyText(wt.path, 'Copied the path.');
    else if (e.target.closest('[data-ready]')) ctx.act.mergeReady(wt);
    else if (e.target.closest('[data-unready]')) ctx.act.mergeUnready(wt.name);
  });
  bar.addEventListener('change', (e) => {
    if (e.target.id !== 'wt-editor') return;
    editor = e.target.value;
    storageSet('blockmap.editor', editor);
    update();
  });

  mergeHost.addEventListener('click', (e) => {
    const row = e.target.closest('[data-mq]');
    if (!row) return;
    const name = row.dataset.mq;
    const act = e.target.closest('[data-mq-act]')?.dataset.mqAct;
    if (act === 'merge') ctx.act.copyMerge(name);
    else if (act === 'fix') ctx.act.askFix(name);
    else if (act === 'rebase') ctx.act.askRebase(name);
    else if (!e.target.closest('.mq-grip')) ctx.focus(name);
  });
  // The grip reorders: dragged with a pointer, or moved a place at a time with the arrow keys.
  mergeHost.addEventListener('keydown', (e) => {
    const grip = e.target.closest('.mq-grip');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    // One move at a time: the next is computed from the order the log has confirmed, not the one still in flight.
    if (moving) return;
    const order = readyOrder();
    const i = order.indexOf(grip.dataset.name);
    const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (to < 0 || to >= order.length) return;
    moving = true;
    ctx.act.mergeMove(grip.dataset.name, to).finally(() => {
      moving = false;
      mergeHost.querySelector(`.mq-grip[data-name="${CSS.escape(grip.dataset.name)}"]`)?.focus();
    });
  });
  mergeHost.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.mq-row[draggable="true"]');
    if (!row) return;
    dragging = row.dataset.mq;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragging);
  });
  mergeHost.addEventListener('dragover', (e) => {
    const row = e.target.closest('.mq-row[draggable="true"]');
    if (!dragging || !row) return;
    e.preventDefault();
    const below = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    for (const r of mergeHost.querySelectorAll('.mq-row')) r.classList.remove('over-top', 'over-bottom');
    if (row.dataset.mq !== dragging) row.classList.add(below ? 'over-bottom' : 'over-top');
  });
  mergeHost.addEventListener('drop', (e) => {
    const row = e.target.closest('.mq-row[draggable="true"]');
    if (!dragging || !row) return;
    e.preventDefault();
    const order = readyOrder().filter((n) => n !== dragging);
    let to = order.indexOf(row.dataset.mq);
    if (row.classList.contains('over-bottom')) to++;
    if (row.dataset.mq !== dragging && to >= 0) ctx.act.mergeMove(dragging, to);
  });
  mergeHost.addEventListener('dragend', () => {
    dragging = null;
    for (const r of mergeHost.querySelectorAll('.mq-row')) r.classList.remove('over-top', 'over-bottom');
    update();
  });

  function readyOrder() {
    return (ctx.mergeRows || []).filter((r) => r.entry.status === 'ready').map((r) => r.entry.worktree);
  }

  function current() {
    return ctx.worktrees?.list.find((w) => w.name === ctx.focusWt) || null;
  }

  function update() {
    const snap = ctx.worktrees;
    const st = ctx.view;
    const now = ctx.viewNow;
    bar.hidden = !snap || snap.list.length < 2;
    if (!snap) return;
    const rows = ctx.mergeRows || [];
    const byName = new Map(rows.map((r) => [r.entry.worktree, r]));
    const order = readyOrder();
    const clashing = new Set((snap.clashes || []).flatMap((c) => [c.a, c.b]));
    const tabs = [`<button type="button" class="wt-tab all" data-wt="" aria-pressed="${!ctx.focusWt}">All</button>`];
    for (const wt of snap.list) {
      const agent = wt.agent;
      const style = agent ? `--ac:${colorOf(st, agent)};--aci:${inkOf(st, agent)}` : '';
      const disc = agent ? `<span class="disc">${esc(initials(agentName(st, agent)))}</span>` : `<span class="disc plain">${icon('branch')}</span>`;
      const meta = [wt.ahead ? `↑${wt.ahead}` : '', wt.behind ? `↓${wt.behind}` : ''].filter(Boolean).join(' ');
      const pos = order.indexOf(wt.name);
      const hurt = wt.conflicts.length ? `Conflicts with ${snap.base}` : clashing.has(wt.name) ? 'Conflicts with another branch' : '';
      const flags = [
        wt.dirty ? `<i class="wt-dirty" title="${wt.dirty} uncommitted"></i>` : '',
        hurt ? `<span class="wt-conflict" title="${esc(hurt)}">${icon('conflict')}</span>` : '',
        pos >= 0 ? `<span class="wt-q" title="Place in the merge queue">#${pos + 1}</span>` : '',
      ].join('');
      const label = agent ? agentName(st, agent) : wt.name;
      const title = [wt.name, wt.branch, agent ? agentName(st, agent) : ''].filter(Boolean).join(', ');
      tabs.push(`<button type="button" class="wt-tab" data-wt="${esc(wt.name)}" aria-pressed="${ctx.focusWt === wt.name}" style="${style}" title="${esc(title)}">${disc}<span class="wt-name">${esc(label)}</span>${meta ? `<span class="wt-meta">${meta}</span>` : ''}${flags}</button>`);
    }
    let detail = '';
    const wt = current();
    if (wt) {
      const m = byName.get(wt.name);
      const queued = m && m.entry.status === 'ready';
      const open = `<span class="wt-open"><span class="solenoid-settings__select-wrap"><select class="solenoid-settings__select" id="wt-editor" aria-label="Editor">${Object.entries(EDITORS).map(([k, [label]]) => `<option value="${k}"${k === editor ? ' selected' : ''}>${label}</option>`).join('')}</select>${ICONS.caret}</span><a class="btn" href="${EDITORS[editor][1]}${encodeURI(wt.path)}">Open</a></span>`;
      const merge = wt.main ? '' : queued ? `<span class="wt-verdict"><i class="${DOT[m.level]}"></i>${esc(m.verdict)}</span><button class="btn" type="button" data-unready>Unqueue</button>` : `<button class="btn" type="button" data-ready>Queue merge</button>`;
      detail = `<div class="wt-detail"><code class="wt-path" data-copy-path title="Copy the path">${esc(wt.path)}</code><span class="wt-branch">${icon('branch')}${esc(wt.branch || '')}</span>${wt.add || wt.del ? `<span class="num" title="Lines changed against ${esc(snap.base)}">+${wt.add} −${wt.del}</span>` : ''}${wt.lastCommit ? `<span class="wt-last" title="${esc(wt.lastCommit.subject)}">${timer(wt.lastCommit.ts, {}, now)}</span>` : ''}<span class="spacer"></span>${merge}<button class="btn" type="button" data-copy-cd>${icon('copy')}cd</button>${open}</div>`;
    }
    setHtml(bar, `<div class="wt-tabs" role="tablist" aria-label="Worktrees">${tabs.join('')}</div>${detail}`);
    if (!dragging) paintQueue(st, snap, now, rows);
  }

  function paintQueue(st, snap, now, rows) {
    mergeHost.hidden = !rows.length;
    if (!rows.length) return;
    const ready = rows.filter((r) => r.entry.status === 'ready');
    const items = rows.map((r) => {
      const isReady = r.entry.status === 'ready';
      const i = ready.indexOf(r);
      const agent = r.entry.agent && st.agents[r.entry.agent] ? r.entry.agent : r.wt?.agent;
      const style = agent && agent !== HUMAN ? `--ac:${colorOf(st, agent)};--aci:${inkOf(st, agent)}` : '';
      const why = r.checks.map((c) => `${c.text}${c.files ? `: ${c.files.slice(0, 4).join(', ')}${c.files.length > 4 ? ', …' : ''}` : ''}`).join('\n');
      const act = !isReady || ctx.replayTs ? ''
        : r.level === 'danger' ? `<button class="btn sm" type="button" data-mq-act="fix">Ask to fix</button>`
        : r.checks.some((c) => c.action === 'rebase') ? `<button class="btn sm" type="button" data-mq-act="rebase">Rebase</button>`
        : i === 0 && r.level === 'ok' ? `<button class="btn sm confirm" type="button" data-mq-act="merge" title="Copy the merge command">Merge</button>`
        : '';
      const grip = isReady && ready.length > 1 ? `<button class="mq-grip" type="button" data-name="${esc(r.entry.worktree)}" aria-label="Reorder ${esc(r.label)}" title="Drag, or use the arrow keys">${icon('grip')}</button>` : '<span></span>';
      const verdict = isReady ? `<span class="mq-verdict" title="${esc(why)}"><i class="${DOT[r.level]}"></i><span>${esc(r.verdict)}</span></span>` : `<span class="mq-verdict"><span>Merged ${timer(r.entry.landedAt, {}, now)}</span></span>`;
      return `<li class="mq-row lvl-${isReady ? r.level : 'done'}${ctx.focusWt === r.entry.worktree ? ' focus' : ''}" data-mq="${esc(r.entry.worktree)}"${isReady && ready.length > 1 ? ' draggable="true"' : ''} style="${style}">${grip}<span class="mq-pos">${isReady ? i + 1 : icon('check')}</span><span class="disc">${esc(initials(r.label))}</span><span class="mq-name" title="${esc(r.entry.branch || r.entry.worktree)}">${esc(r.label)}</span>${verdict}${act || '<span></span>'}</li>`;
    });
    setHtml(mergeHost, `<section class="win mq" data-win="merge"><div class="win-head"><span class="disc plain">${icon('branch')}</span><div class="win-name">Merge queue</div><span class="win-count" title="The branch these merge into">${esc(snap.base)}</span></div><ol class="mq-list">${items.join('')}</ol></section>`);
  }

  return { update };
}

// The blocks each worktree changed, and the worktrees each block was changed in, for the map: an entry says
// which worktrees touched the block, whether one of them conflicts with the base in it, and which pairs of
// branches the forecast says will conflict in it.
export function worktreeIndex(st, snap) {
  const byBlock = new Map();
  const byTree = new Map();
  const blockOfFile = (f) => [...blocksOf(st, { files: [f] }).keys()][0];
  for (const wt of snap?.list || []) {
    const blocks = blocksOf(st, wt);
    byTree.set(wt.name, blocks);
    if (wt.main) continue;
    const label = wt.agent ? agentName(st, wt.agent) : wt.name;
    const conflicted = new Set(wt.conflicts.map(blockOfFile));
    for (const [id] of blocks) {
      if (!byBlock.has(id)) byBlock.set(id, { trees: [], conflict: null, clash: false, clashes: [] });
      const entry = byBlock.get(id);
      entry.trees.push({ name: wt.name, agent: wt.agent, label });
      if (conflicted.has(id)) entry.conflict = label;
    }
  }
  const labelOf = (name) => {
    const wt = snap?.list.find((w) => w.name === name);
    return wt?.agent ? agentName(st, wt.agent) : name;
  };
  for (const c of snap?.clashes || []) {
    for (const id of new Set(c.files.map(blockOfFile))) {
      const entry = byBlock.get(id);
      if (!entry) continue;
      entry.clash = true;
      entry.clashes.push({ a: labelOf(c.a), b: labelOf(c.b), files: c.files });
    }
  }
  return { byBlock, byTree };
}
