// The map: districts of slots, one tile per block, and the socket a tile leaves when it's away.
//
// Tiles are all one size; districts are packed into bands as tall as a few tiles, each district as wide as it
// needs, so the map fills its width and reads at full size. A tile in the Work lens carries only what is live:
// conflicts, failing tests, bugs, a lock. Backlog decisions and tasks belong to the Issues lens.

import { UNMAPPED, HUMAN, blockMeta, itemCounts, heat, recentToucher, footprints, isStale, agentName } from '../core/model.js';
import { h, icon, setHtml, toggle, initials, esc, timer } from './dom.js';

const ZOOM_FLOOR = 0.92;
const HOUR = 3600_000;

// An agent's color is a palette slot (older logs may hold a hex), so it follows the palette.
export function colorOf(st, agentId) {
  if (agentId === HUMAN) return 'var(--human)';
  return slotVar(st.agents[agentId]?.color, '', 'var(--text-muted)');
}

// A color from the log reaches style attributes, so only a slot name or a hex code passes.
function slotVar(c, suffix, fallback) {
  if (typeof c !== 'string') return fallback;
  if (/^[a-z]{2,16}$/.test(c)) return `var(--slot-${c}${suffix})`;
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return suffix ? '#1a1a1a' : c;
  return fallback;
}

export function inkOf(st, agentId) {
  if (agentId === HUMAN) return 'var(--slot-gray-ink)';
  return slotVar(st.agents[agentId]?.color, '-ink', '#1a1a1a');
}

export function createMap(ctx, root) {
  const slots = new Map();
  const tiles = new Map();
  const sockets = new Map();
  let districts = [];
  let zoom = 1;
  let fitKey = '';

  function build(board) {
    root.textContent = '';
    slots.clear();
    sockets.clear();
    districts = [];
    const byDistrict = new Map(board.districts.map((d) => [d.id, []]));
    for (const b of board.blocks) {
      if (!byDistrict.has(b.district)) byDistrict.set(b.district, []);
      byDistrict.get(b.district).push(b);
    }
    const list = [...board.districts];
    for (const id of byDistrict.keys()) if (!list.find((d) => d.id === id)) list.push({ id, name: id });
    if ((board.unmapped?.files || 0) > 0) {
      list.push({ id: '_unmapped', name: 'Unclaimed' });
      byDistrict.set('_unmapped', [{ id: UNMAPPED, name: 'Unmapped files', district: '_unmapped' }]);
    }
    for (const d of list) {
      const blocks = byDistrict.get(d.id) || [];
      if (!blocks.length) continue;
      const grid = h('div', { class: 'district-grid' });
      const el = h('section', { class: 'district', 'data-district': d.id, title: d.about || '' }, h('div', { class: 'district-label' }, d.name), grid);
      root.append(el);
      districts.push({ id: d.id, el, grid, blocks: blocks.map((b) => b.id) });
      for (const b of blocks) {
        const slot = h('div', { class: 'slot', 'data-slot': b.id });
        grid.append(slot);
        slots.set(b.id, slot);
        const tile = tiles.get(b.id) || makeTile(b.id);
        tile.classList.toggle('unmapped', b.id === UNMAPPED);
        const socket = h('div', { class: 'socket', 'data-socket': b.id, hidden: true }, h('div', { class: 'sk-name' }, b.name), h('div', { class: 'sk-foot' }, h('span', { class: 'sk-who' }), h('span', { class: 'sk-time' })));
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

  // Pack the districts, in order, into shelves: a shelf is R tiles tall and each district on it takes
  // ceil(n / R) columns. Which districts share a shelf and how tall each shelf is are chosen together (a small
  // dynamic program over the order) for the least total height that fits the width. Only if that still runs
  // past the bottom does the map scale, never below 92% (its 12px names stay at 11px); past that it scrolls.
  // Phones get three columns everywhere.
  function fit() {
    const wrap = root.parentElement;
    const barH = wrap.querySelector('.wt-bar:not([hidden])')?.offsetHeight || 0;
    const visible = districts.map((d) => d.blocks.filter((id) => !slots.get(id).hidden).length);
    const key = `${wrap.clientWidth}x${wrap.clientHeight}x${barH}x${visible.join(',')}`;
    if (key === fitKey) return;
    fitKey = key;
    districts.forEach((d, i) => {
      d.el.hidden = !visible[i];
    });
    const shown = districts.filter((d, i) => visible[i]);
    const phone = matchMedia('(max-width: 860px)').matches;
    if (phone) {
      for (const d of districts) d.grid.style.setProperty('--cols', '3');
      placeShelves([shown]);
      root.style.zoom = '';
      zoom = 1;
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const uw = parseFloat(css.getPropertyValue('--unit-w')) || 128;
    const uh = parseFloat(css.getPropertyValue('--unit-h')) || 44;
    const gap = parseFloat(css.getPropertyValue('--gap')) || 6;
    const PAD_X = 18;
    const PAD_Y = 34;
    const BETWEEN = 12;
    const W = wrap.clientWidth - 2 * 12;
    const H = wrap.clientHeight - barH - 2 * 12;
    const ns = shown.map((d) => visible[districts.indexOf(d)]);
    const m = ns.length;
    const widthOf = (n, R) => {
      const c = Math.ceil(n / R);
      return c * uw + (c - 1) * gap + PAD_X;
    };
    const shelfH = (R) => R * uh + (R - 1) * gap + PAD_Y;
    const Rmax = Math.min(12, Math.max(1, ...ns));
    // best[i]: the least height for districts i.. onward, and the shelf (end, R) that starts it.
    const best = new Array(m + 1).fill(null);
    best[m] = { h: 0 };
    for (let i = m - 1; i >= 0; i--) {
      for (let R = 1; R <= Rmax; R++) {
        let w = -BETWEEN;
        for (let j = i; j < m; j++) {
          w += BETWEEN + widthOf(ns[j], R);
          // A district too wide even alone is fine only one tile across (it then has to scroll).
          if (w > W && (j > i || Math.ceil(ns[j] / R) > 1)) break;
          const rows = Math.max(...ns.slice(i, j + 1).map((n) => Math.ceil(n / Math.ceil(n / R))));
          const h = shelfH(rows) + (j + 1 < m ? BETWEEN : 0) + best[j + 1].h;
          if (!best[i] || h < best[i].h - 0.5) best[i] = { h, end: j, R };
        }
      }
    }
    const shelves = [];
    for (let i = 0; i < m; ) {
      const { end, R } = best[i];
      const group = shown.slice(i, end + 1);
      group.forEach((d, k) => d.grid.style.setProperty('--cols', String(Math.max(1, Math.ceil(ns[i + k] / R)))));
      shelves.push(group);
      i = end + 1;
    }
    placeShelves(shelves);
    let z = 1;
    root.style.zoom = '1';
    for (; z > ZOOM_FLOOR; z -= 0.02) {
      root.style.zoom = String(z);
      if (root.getBoundingClientRect().height <= wrap.clientHeight - barH + 1) break;
    }
    zoom = Math.max(ZOOM_FLOOR, z);
    root.style.zoom = String(zoom);
  }

  // Each shelf is a row of its own, so the rows break where the packing decided, not where flex would.
  function placeShelves(groups) {
    const rows = [...root.querySelectorAll(':scope > .shelf')];
    groups.forEach((group, i) => {
      let row = rows[i];
      if (!row) {
        row = h('div', { class: 'shelf' });
        root.append(row);
        rows.push(row);
      }
      group.forEach((d, k) => {
        if (row.children[k] !== d.el) row.insertBefore(d.el, row.children[k] || null);
      });
    });
    for (const d of districts) if (d.el.hidden && d.el.parentElement !== root) root.append(d.el);
    rows.slice(groups.length).forEach((r) => r.remove());
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

  // Whether a block has anything going on, for the active-only view.
  function active(st, id, now, c, wtEntry) {
    const b = st.blocks[id];
    if (b.holder || b.queued || b.frozen || wtEntry || ctx.selected === id) return true;
    if (b.test && !b.test.ok && now - b.test.ts < 6 * HOUR) return true;
    const last = b.touches[b.touches.length - 1];
    if (last && now - last.ts < 2 * HOUR) return true;
    return ctx.lens === 'issues' && c.open > 0;
  }

  function paint() {
    const st = ctx.view;
    const now = ctx.viewNow;
    const q = ctx.search;
    const lens = ctx.lens;
    const trespass = new Set(ctx.alertList.filter((a) => a.kind === 'trespass' || a.kind === 'frozen').map((a) => a.block));
    const focusBlocks = ctx.focusWt ? ctx.wtIndex?.byTree.get(ctx.focusWt) : null;
    const focusAgent = ctx.focusWt ? ctx.worktrees?.list.find((w) => w.name === ctx.focusWt)?.agent : null;
    for (const [id, tile] of tiles) {
      const meta = blockMeta(st, id) || { name: id };
      const b = st.blocks[id];
      if (!b) continue;
      const c = itemCounts(st, id);
      const hv = heat(b, now);
      const wtEntry = ctx.wtIndex?.byBlock.get(id);
      const [nameEl, badgesEl, feetEl, pulse] = tile.children;
      if (nameEl.textContent !== meta.name) nameEl.textContent = meta.name;
      const inTray = !!tile.closest('.tray');

      const slot = slots.get(id);
      if (slot) slot.hidden = !!ctx.activeOnly && !active(st, id, now, c, wtEntry) && !inTray;

      const parts = [];
      // A collision is red only where git says the merge would conflict: with the base, or between two
      // branches. Branches that merely touch the same block show their count, uncolored.
      const clash = wtEntry && (wtEntry.conflict || wtEntry.clash);
      if (trespass.has(id)) parts.push(`<span class="badge danger" title="Edited by an agent that doesn't hold it">${icon('conflict')}</span>`);
      if (clash) parts.push(`<span class="badge danger" title="${esc(clashText(wtEntry))}">${icon('branch')}${wtEntry.trees.length}</span>`);
      else if (wtEntry && wtEntry.trees.length >= 2) parts.push(`<span class="badge" title="Changed in ${esc(wtEntry.trees.map((w) => w.label).join(', '))}">${icon('branch')}${wtEntry.trees.length}</span>`);
      if (b.test && !b.test.ok && now - b.test.ts < 6 * HOUR) parts.push(`<span class="badge danger" title="${esc(b.test.summary || 'Tests fail')}">${icon('cross')}</span>`);
      if (c.bug) parts.push(`<span class="badge danger" title="Open bugs">${icon('bug')}${c.bug}</span>`);
      if (lens === 'issues' && c.decision + c.question) parts.push(`<span class="badge you" title="Your call">${icon('decision')}${c.decision + c.question}</span>`);
      if (lens === 'issues' && c.task) parts.push(`<span class="badge" title="Open tasks">${icon('task')}${c.task}</span>`);
      if (b.frozen) parts.push(`<span class="badge" title="Frozen${b.frozen.note ? `: ${esc(b.frozen.note)}` : ''}">${icon('lock')}</span>`);
      const watchers = Object.keys(b.watchers);
      if (watchers.length) parts.push(`<span class="badge" title="${watchers.map((w) => esc(agentName(st, w))).join(', ')}">${icon('eye')}${watchers.length}</span>`);
      if (inTray && b.holder) parts.push(timer(b.since, { cls: 'badge', warn: 2 * HOUR }, now));
      else if (inTray && b.queued) parts.push(timer(b.queued.ts, { cls: 'badge' }, now));
      setHtml(badgesEl, parts.join(''));

      const toucher = recentToucher(b, now, HOUR);
      const feet = lens === 'branches' ? (wtEntry?.trees || []).map((w) => w.agent).filter(Boolean).slice(0, 4) : lens === 'heat' ? footprints(b, now, 45 * 60_000).slice(0, 4) : [];
      setHtml(feetEl, feet.map((a) => `<i style="--fc:${colorOf(st, a)};--fci:${inkOf(st, a)}" title="${esc(agentName(st, a))}">${esc(initials(agentName(st, a)))}</i>`).join(''));
      tile.style.setProperty('--tc', toucher && lens === 'heat' ? colorOf(st, toucher) : 'var(--text-muted)');
      tile.style.setProperty('--ta', toucher && lens === 'heat' ? String(Math.min(1, 0.35 + hv * 0.3).toFixed(2)) : '0');
      const last = b.touches[b.touches.length - 1];
      pulse.hidden = !(last && now - last.ts < 3 * 60_000);

      let lv = 0;
      let lc = '';
      if (lens === 'heat') {
        lv = Math.min(55, hv * 20);
        lc = 'var(--slot-amber)';
      } else if (lens === 'issues') {
        // Weight, not alarm: the reddest tile stays well short of a conflict's tint.
        lv = Math.min(24, (c.bug * 3 + c.task + (c.decision + c.question) * 2) * 1.4);
        lc = 'var(--slot-vermilion)';
      } else if (lens === 'branches' && wtEntry) {
        const only = wtEntry.trees.length === 1 ? wtEntry.trees[0].agent : null;
        lc = clash ? 'var(--danger)' : only ? colorOf(st, only) : 'var(--text-dim)';
        lv = clash ? 30 : 18;
      }
      if (focusBlocks?.has(id) && focusAgent) {
        lc = colorOf(st, focusAgent);
        lv = 26;
      }
      tile.style.setProperty('--lv', `${Math.round(lv)}%`);
      tile.style.setProperty('--lc', lc || 'var(--surface)');
      toggle(tile, 'frozen', !!b.frozen);
      toggle(tile, 'conflict', trespass.has(id) || !!clash);
      toggle(tile, 'selected', ctx.selected === id);
      const filtered = ctx.filter === 'bugs' ? c.bug > 0 : true;
      const matched = q ? q.matches.has(id) : false;
      const inFocus = focusBlocks ? focusBlocks.has(id) : true;
      toggle(tile, 'dim', (!!q && !matched) || !filtered || !inFocus);
      toggle(tile, 'match', !!q && matched && q.exact);
      tile.title = b.holder ? `${meta.name}, held by ${agentName(st, b.holder)}${b.intent ? `: ${b.intent}` : ''}` : meta.name;

      const socket = sockets.get(id);
      if (socket) paintSocket(st, now, socket, b);
    }
  }

  function paintSocket(st, now, socket, b) {
    const away = !!(b.holder || b.queued);
    socket.hidden = !away;
    toggle(socket, 'selected', ctx.selected === b.id);
    if (!away) return;
    const [, foot] = socket.children;
    const [who, time] = foot.children;
    if (b.holder) {
      const a = st.agents[b.holder];
      socket.style.setProperty('--sc', colorOf(st, b.holder));
      socket.style.setProperty('--sci', inkOf(st, b.holder));
      socket.classList.remove('queued');
      socket.classList.add('held');
      toggle(socket, 'stale', isStale(st, b.holder, now));
      socket.title = `${a?.name || b.holder}${b.intent ? `: ${b.intent}` : ''}`;
      setHtml(who, `<span class="dot">${esc(initials(a?.name))}</span><span class="sk-agent">${esc(a?.name || '')}</span>`);
      setHtml(time, timer(b.since, { warn: 2 * HOUR }, now));
    } else {
      socket.style.removeProperty('--sc');
      socket.classList.add('queued');
      socket.classList.remove('stale', 'held');
      socket.title = b.queued.note || 'Up next';
      setHtml(who, '<span class="sk-agent">Next</span>');
      setHtml(time, timer(b.queued.ts, {}, now));
    }
  }

  return { build, paint, fit, refit: () => (fitKey = ''), tiles, slots, sockets, get zoom() { return zoom; } };
}

function clashText(entry) {
  const parts = [];
  if (entry.conflict) parts.push(`${entry.conflict} conflicts with the base`);
  for (const c of entry.clashes || []) parts.push(`${c.a} and ${c.b} conflict`);
  return parts.join('; ') || 'Conflicts at merge';
}
