// The map: districts of slots, one tile per block, and the socket a tile leaves when it's away.

import { UNMAPPED, HUMAN, blockMeta, itemCounts, heat, recentToucher, footprints, isStale, agentName } from '../core/model.js';
import { h, icon, setHtml, toggle, initials, esc, timer } from './dom.js';

export function sizeOf(meta) {
  if (meta?.files === undefined) return 'm';
  if (meta.files >= 60) return 'm';
  return 's';
}

const UNITS = { s: 1, m: 2, l: 4 };

// An agent's color is a palette slot (older logs may hold a hex), so it follows the palette.
export function colorOf(st, agentId) {
  if (agentId === HUMAN) return 'var(--human)';
  const c = st.agents[agentId]?.color;
  if (!c) return 'var(--text-muted)';
  return c.startsWith('#') ? c : `var(--slot-${c})`;
}

export function inkOf(st, agentId) {
  if (agentId === HUMAN) return 'var(--slot-gray-ink)';
  const c = st.agents[agentId]?.color;
  return !c || c.startsWith('#') ? '#1a1a1a' : `var(--slot-${c}-ink)`;
}

export function createMap(ctx, root) {
  const slots = new Map();
  const tiles = new Map();
  const sockets = new Map();
  let zoom = 1;
  let fitKey = '';

  function build(board) {
    root.textContent = '';
    slots.clear();
    sockets.clear();
    const byDistrict = new Map(board.districts.map((d) => [d.id, []]));
    for (const b of board.blocks) {
      if (!byDistrict.has(b.district)) byDistrict.set(b.district, []);
      byDistrict.get(b.district).push(b);
    }
    const districts = [...board.districts];
    for (const id of byDistrict.keys()) if (!districts.find((d) => d.id === id)) districts.push({ id, name: id });
    if ((board.unmapped?.files || 0) > 0) {
      districts.push({ id: '_unmapped', name: 'Unclaimed' });
      byDistrict.set('_unmapped', [{ id: UNMAPPED, name: 'Unmapped files', files: board.unmapped.files, district: '_unmapped' }]);
    }
    for (const d of districts) {
      const blocks = byDistrict.get(d.id) || [];
      if (!blocks.length) continue;
      const order = [...blocks].sort((a, b) => UNITS[sizeOf(b)] - UNITS[sizeOf(a)]);
      const units = order.reduce((n, b) => n + UNITS[sizeOf(b)], 0);
      const cols = Math.max(2, Math.min(5, Math.round(Math.sqrt(units * 1.5))));
      const grid = h('div', { class: 'district-grid', style: { '--cols': cols } });
      root.append(h('section', { class: 'district', 'data-district': d.id, title: d.about || '' }, h('div', { class: 'district-label' }, d.name), grid));
      for (const b of order) {
        const size = sizeOf(b);
        const slot = h('div', { class: `slot s-${size}`, 'data-slot': b.id });
        grid.append(slot);
        slots.set(b.id, slot);
        const tile = tiles.get(b.id) || makeTile(b.id);
        tile.classList.remove('s-s', 's-m', 's-l');
        tile.classList.add(`s-${size}`);
        tile.classList.toggle('unmapped', b.id === UNMAPPED);
        const socket = h('div', { class: 'socket', 'data-socket': b.id, hidden: true }, h('div', { class: 'sk-name' }, b.name), h('span', { class: 'sk-who' }), h('span', { class: 'sk-time' }));
        socket.addEventListener('click', () => ctx.select(b.id));
        sockets.set(b.id, socket);
        slot.append(socket, tile);
      }
    }
    for (const [id, tile] of tiles) {
      if (slots.has(id)) continue;
      tile.remove();
      tiles.delete(id);
    }
    fitKey = '';
  }

  // Scale the map down until every district fits the space it has, but never below 85%, where its 11px
  // text would drop under a legible size; past that the map scrolls. Phones scroll at full size.
  function fit() {
    const wrap = root.parentElement;
    const barH = wrap.querySelector('.wt-bar:not([hidden])')?.offsetHeight || 0;
    const key = `${wrap.clientWidth}x${wrap.clientHeight}x${tiles.size}x${barH}`;
    if (key === fitKey) return;
    fitKey = key;
    if (matchMedia('(max-width: 860px)').matches) {
      root.style.zoom = '';
      zoom = 1;
      return;
    }
    let z = 1;
    for (; z > 0.85; z -= 0.03) {
      root.style.zoom = String(z);
      const r = root.getBoundingClientRect();
      if (r.height <= wrap.clientHeight - barH + 1 && r.width <= wrap.clientWidth + 1) break;
    }
    zoom = Math.max(0.85, z);
    root.style.zoom = String(zoom);
  }

  function makeTile(id) {
    const tile = h(
      'div',
      { class: 'tile', 'data-block': id, tabindex: '0', role: 'button' },
      h('div', { class: 'tile-name' }),
      h('div', { class: 'tile-badges' }),
      h('div', { class: 'feet' }),
      h('span', { class: 'pulse', hidden: true }),
    );
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        ctx.select(id);
      }
    });
    tiles.set(id, tile);
    return tile;
  }

  function paint() {
    const st = ctx.view;
    const now = ctx.viewNow;
    const q = ctx.search;
    const conflicted = new Set(ctx.alertList.filter((a) => a.kind === 'trespass' || a.kind === 'frozen').map((a) => a.block));
    for (const [id, tile] of tiles) {
      const meta = blockMeta(st, id) || { name: id };
      const b = st.blocks[id];
      if (!b) continue;
      const c = itemCounts(st, id);
      const hv = heat(b, now);
      const toucher = recentToucher(b, now, 60 * 60_000);
      const [nameEl, badgesEl, feetEl, pulse] = tile.children;
      if (nameEl.textContent !== meta.name) nameEl.textContent = meta.name;

      // Work shows what matters now: conflicts, failing tests, bugs, what needs the human, locks. Issues adds the
      // task count; Heat adds who passed through. Passing tests and other agents' colors stay out of Work.
      const lens = ctx.lens;
      const inTray = !!tile.closest('.tray');
      const parts = [];
      if (conflicted.has(id)) parts.push(`<span class="badge conflict" title="Edited by an agent that doesn't hold it">${icon('conflict')}</span>`);
      if (b.test && !b.test.ok && now - b.test.ts < 6 * 3600_000) parts.push(`<span class="badge fail" title="${esc(b.test.summary || 'Tests fail')}">${icon('cross')}</span>`);
      if (c.decision + c.question) parts.push(`<span class="badge you" title="Waiting on ${esc(st.agents[HUMAN].name)}">${icon('decision')}${c.decision + c.question}</span>`);
      if (c.bug) parts.push(`<span class="badge bug" title="Open bugs">${icon('bug')}${c.bug}</span>`);
      if (lens === 'issues' && c.task) parts.push(`<span class="badge" title="Open tasks">${icon('task')}${c.task}</span>`);
      // Changed in two or more worktrees: those branches will meet at the merge. Red when one already
      // conflicts with the base in a file of this block.
      const wtEntry = ctx.wtIndex?.byBlock.get(id);
      if (wtEntry && (wtEntry.trees.length >= 2 || wtEntry.conflict)) {
        parts.push(`<span class="badge branches${wtEntry.conflict ? ' fail' : ''}" title="Changed in ${esc(wtEntry.trees.map((w) => w.name).join(', '))}${wtEntry.conflict ? `; conflicts with ${esc(ctx.worktrees.base)}` : ''}">${icon('branch')}${wtEntry.trees.length}</span>`);
      }
      if (b.frozen) parts.push(`<span class="badge" title="Frozen${b.frozen.note ? `: ${esc(b.frozen.note)}` : ''}">${icon('lock')}</span>`);
      const watchers = Object.keys(b.watchers);
      if (watchers.length) parts.push(`<span class="badge" title="${watchers.map((w) => esc(agentName(st, w))).join(', ')}">${icon('eye')}${watchers.length}</span>`);
      if (inTray && b.holder) parts.push(timer(b.since, { cls: 'badge' }, now));
      else if (inTray && b.queued) parts.push(timer(b.queued.ts, { cls: 'badge' }, now));
      setHtml(badgesEl, parts.join(''));

      const showWho = lens === 'heat';
      const feet = lens === 'branches' ? (wtEntry?.trees || []).slice(0, 3).map((w) => w.agent).filter(Boolean) : showWho ? footprints(b, now, 45 * 60_000).slice(0, 3) : [];
      setHtml(feetEl, feet.map((a) => `<i style="--fc:${colorOf(st, a)}" title="${esc(agentName(st, a))}"></i>`).join(''));
      tile.style.setProperty('--tc', toucher && showWho ? colorOf(st, toucher) : 'var(--text-muted)');
      tile.style.setProperty('--ta', toucher && showWho ? String(Math.min(1, 0.35 + hv * 0.3).toFixed(2)) : '0');
      const last = b.touches[b.touches.length - 1];
      pulse.hidden = !(last && now - last.ts < 3 * 60_000);
      let lv = 0;
      let lc = '';
      if (lens === 'heat') lv = Math.min(60, hv * 22);
      else if (lens === 'issues') lv = Math.min(50, (c.bug * 3 + c.task + (c.decision + c.question) * 2) * 2.6);
      else if (lens === 'branches' && wtEntry) {
        // One worktree: its agent's color. Several: gold, since they will meet at the merge.
        const only = wtEntry.trees.length === 1 ? wtEntry.trees[0].agent : null;
        lc = wtEntry.conflict ? 'var(--danger)' : wtEntry.trees.length > 1 ? 'var(--warn)' : only ? colorOf(st, only) : 'var(--text-muted)';
        lv = wtEntry.trees.length > 1 || wtEntry.conflict ? 30 : 20;
      }
      tile.style.setProperty('--lv', `${Math.round(lv)}%`);
      if (lc) tile.style.setProperty('--lc', lc);
      else tile.style.removeProperty('--lc');
      toggle(tile, 'frozen', !!b.frozen);
      toggle(tile, 'conflict', conflicted.has(id));
      toggle(tile, 'selected', ctx.selected === id);
      const filtered = ctx.filter === 'you' ? c.decision + c.question > 0 : ctx.filter === 'bugs' ? c.bug > 0 : true;
      const matched = q ? q.matches.has(id) : false;
      const focusBlocks = ctx.focusWt ? ctx.wtIndex?.byTree.get(ctx.focusWt) : null;
      const inFocus = focusBlocks ? focusBlocks.has(id) : true;
      toggle(tile, 'dim', (!!q && !matched) || !filtered || !inFocus);
      toggle(tile, 'match', (!!q && matched && q.exact) || (!!focusBlocks && inFocus));
      tile.title = b.holder ? `${meta.name}, held by ${agentName(st, b.holder)}${b.intent ? `: ${b.intent}` : ''}` : meta.name;

      const socket = sockets.get(id);
      if (socket) paintSocket(st, now, socket, b);
    }
  }

  function paintSocket(st, now, socket, b) {
    const away = !!(b.holder || b.queued);
    socket.hidden = !away;
    if (!away) return;
    const [, who, time] = socket.children;
    if (b.holder) {
      const a = st.agents[b.holder];
      socket.style.setProperty('--sc', colorOf(st, b.holder));
      socket.style.setProperty('--sci', inkOf(st, b.holder));
      socket.classList.remove('queued');
      toggle(socket, 'stale', isStale(st, b.holder, now));
      socket.title = `${a?.name || b.holder}${b.intent ? `: ${b.intent}` : ''}`;
      setHtml(who, `<span class="dot">${esc(initials(a?.name))}</span>`);
      setHtml(time, timer(b.since, {}, now));
      socket.classList.add('held');
    } else {
      socket.style.removeProperty('--sc');
      socket.classList.add('queued');
      socket.classList.remove('stale', 'held');
      socket.title = b.queued.note || 'Up next';
      setHtml(who, '<span class="next">Next</span>');
      setHtml(time, timer(b.queued.ts, {}, now));
    }
  }

  return { build, paint, fit, tiles, slots, sockets, get zoom() { return zoom; } };
}
