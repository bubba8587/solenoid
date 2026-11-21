// Worktrees on the page: a tab strip over the map (all of them, or one in focus, with its path, a cd and an
// editor link for jumping into it) and the merge queue window, with what each queued branch would run into.

import { HUMAN, agentName } from '../core/model.js';
import { mergeChecks, mergeCommand, blocksOf } from '../core/merges.js';
import { icon, setHtml, esc, timer, initials, toast, storageGet, storageSet } from './dom.js';
import { colorOf, inkOf } from './map.js';

const EDITORS = { vscode: ['VS Code', 'vscode://file'], cursor: ['Cursor', 'cursor://file'], zed: ['Zed', 'zed://file'] };

export function createWorktrees(ctx, bar, mergeHost) {
  let editor = storageGet('blockmap.editor', 'vscode');

  bar.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-wt]');
    if (tab) {
      ctx.focus(tab.dataset.wt || null);
      return;
    }
    const wt = current();
    if (!wt) return;
    if (e.target.closest('[data-copy-cd]')) copy(`cd "${wt.path}"`, 'Copied the cd command.');
    else if (e.target.closest('[data-copy-path]')) copy(wt.path, 'Copied the path.');
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
    if (e.target.closest('[data-mq-copy]')) {
      const entry = ctx.view.merges[name];
      copy(mergeCommand(entry), 'Copied the merge command.');
    } else if (e.target.closest('[data-mq-up]')) ctx.act.mergeUp(name);
    else ctx.focus(name);
  });

  function current() {
    return ctx.worktrees?.list.find((w) => w.name === ctx.focusWt) || null;
  }

  function copy(text, done) {
    navigator.clipboard?.writeText(text).then(() => toast(done), () => toast(text)) ?? toast(text);
  }

  function update() {
    const snap = ctx.worktrees;
    const st = ctx.view;
    const now = ctx.viewNow;
    bar.hidden = !snap || snap.list.length < 2;
    if (!snap) return;
    const checks = new Map(mergeChecks(st, snap, now).map((c) => [c.entry.worktree, c]));
    const order = mergeChecks(st, snap, now).filter((c) => c.entry.status === 'ready').map((c) => c.entry.worktree);
    const tabs = [`<button type="button" class="wt-tab" data-wt="" aria-pressed="${!ctx.focusWt}">All</button>`];
    for (const wt of snap.list) {
      const agent = wt.agent;
      const style = agent ? `--ac:${colorOf(st, agent)};--aci:${inkOf(st, agent)}` : '';
      const disc = agent ? `<span class="disc">${esc(initials(agentName(st, agent)))}</span>` : `<span class="disc plain">${icon('branch')}</span>`;
      const meta = [wt.ahead ? `↑${wt.ahead}` : '', wt.behind ? `↓${wt.behind}` : ''].filter(Boolean).join(' ');
      const pos = order.indexOf(wt.name);
      const flags = [
        wt.dirty ? `<i class="wt-dirty" title="${wt.dirty} uncommitted"></i>` : '',
        wt.conflicts.length ? `<span class="wt-conflict" title="Conflicts with ${esc(snap.base)}">${icon('conflict')}</span>` : '',
        pos >= 0 ? `<span class="wt-q" title="Merge queue position">#${pos + 1}</span>` : '',
      ].join('');
      const title = `${wt.branch || wt.name}${agent ? `, ${agentName(st, agent)}` : ''}`;
      tabs.push(`<button type="button" class="wt-tab" data-wt="${esc(wt.name)}" aria-pressed="${ctx.focusWt === wt.name}" style="${style}" title="${esc(title)}">${disc}<span class="wt-name">${esc(wt.name)}</span>${meta ? `<span class="wt-meta">${meta}</span>` : ''}${flags}</button>`);
    }
    let detail = '';
    const wt = current();
    if (wt) {
      const m = checks.get(wt.name);
      const queued = m && m.entry.status === 'ready';
      const editorLinks = `<select id="wt-editor" aria-label="Editor">${Object.entries(EDITORS).map(([k, [label]]) => `<option value="${k}"${k === editor ? ' selected' : ''}>${label}</option>`).join('')}</select><a class="btn" href="${EDITORS[editor][1]}${encodeURI(wt.path)}">Open</a>`;
      const merge = wt.main ? '' : queued ? `<span class="mq-verdict lvl-${m.level}">${esc(m.verdict)}</span><button class="btn" type="button" data-unready>Unqueue</button>` : `<button class="btn" type="button" data-ready>Queue merge</button>`;
      detail = `<div class="wt-detail"><code class="wt-path" data-copy-path title="Copy the path">${esc(wt.path)}</code><span class="wt-branch">${icon('branch')}${esc(wt.branch || '')}</span>${wt.add || wt.del ? `<span class="num">+${wt.add} −${wt.del}</span>` : ''}${wt.lastCommit ? `<span class="wt-last" title="${esc(wt.lastCommit.subject)}">${timer(wt.lastCommit.ts, {}, now)}</span>` : ''}<span class="spacer"></span>${merge}<button class="btn" type="button" data-copy-cd>${icon('copy')}cd</button>${editorLinks}</div>`;
    }
    setHtml(bar, `<div class="wt-tabs" role="tablist" aria-label="Worktrees">${tabs.join('')}</div>${detail}`);
    paintQueue(st, snap, now, [...checks.values()]);
  }

  function paintQueue(st, snap, now, rows) {
    const ready = rows.filter((r) => r.entry.status === 'ready');
    mergeHost.hidden = !rows.length;
    if (!rows.length) return;
    const items = rows.map((r) => {
      const isReady = r.entry.status === 'ready';
      const i = ready.indexOf(r);
      const agent = r.entry.agent && st.agents[r.entry.agent] ? r.entry.agent : r.wt?.agent;
      const style = agent && agent !== HUMAN ? `--ac:${colorOf(st, agent)};--aci:${inkOf(st, agent)}` : '';
      const ab = r.wt && isReady ? [r.wt.ahead ? `↑${r.wt.ahead}` : '', r.wt.behind ? `↓${r.wt.behind}` : ''].filter(Boolean).join(' ') : '';
      const detail = r.checks.map((c) => `${c.text}${c.files ? `: ${c.files.slice(0, 4).join(', ')}` : ''}`).join('\n');
      const tools = isReady ? (i === 0 ? `<button class="icon-btn" type="button" data-mq-copy aria-label="Copy the merge command" title="Copy the merge command">${icon('copy')}</button>` : `<button class="icon-btn" type="button" data-mq-up aria-label="Move up" title="Move up">${icon('up')}</button>`) : '';
      return `<li class="mq-row lvl-${isReady ? r.level : 'done'}${ctx.focusWt === r.entry.worktree ? ' focus' : ''}" data-mq="${esc(r.entry.worktree)}" style="${style}" title="${esc(detail)}"><span class="mq-pos">${isReady ? i + 1 : icon('check')}</span><span class="disc">${esc(initials(agent ? agentName(st, agent) : r.entry.worktree))}</span><span class="mq-name">${esc(r.entry.worktree)}</span><span class="mq-verdict">${esc(r.verdict)}</span><span class="mq-ab num">${ab}</span>${timer(isReady ? r.entry.readyAt : r.entry.landedAt, {}, now)}${tools}</li>`;
    });
    setHtml(mergeHost, `<section class="win compact mq" data-win="merge"><div class="win-head"><span class="disc plain">${icon('branch')}</span><div class="win-name">Merge queue</div><span class="win-count">into ${esc(snap.base)}</span></div><ol class="mq-list">${items.join('')}</ol></section>`);
  }

  return { update };
}

// The blocks each worktree changed, and the worktrees each block was changed in, for the map.
export function worktreeIndex(st, snap) {
  const byBlock = new Map();
  const byTree = new Map();
  for (const wt of snap?.list || []) {
    const blocks = blocksOf(st, wt);
    byTree.set(wt.name, blocks);
    if (wt.main) continue;
    const conflicted = new Set(wt.conflicts);
    for (const [id] of blocks) {
      if (!byBlock.has(id)) byBlock.set(id, { trees: [], conflict: false });
      const entry = byBlock.get(id);
      entry.trees.push(wt);
      if (wt.files.some((f) => conflicted.has(f) && blocksOf(st, { files: [f] }).has(id))) entry.conflict = true;
    }
  }
  return { byBlock, byTree };
}
