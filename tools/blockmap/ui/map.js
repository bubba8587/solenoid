// The map: districts of slots, one tile per block, and the socket a tile leaves when it's away.

import { UNMAPPED, HUMAN, blockMeta, itemCounts, heat, recentToucher, footprints, isStale, agentName, ago } from '../core/model.js';
import { h, icon, setHtml, toggle, initials } from './dom.js';

export function sizeOf(meta) {
  if (meta?.files === undefined) return 'm';
  if (meta.files >= 300) return 'l';
  if (meta.files >= 60) return 'm';
  return 's';
}

const UNITS = { s: 1, m: 2, l: 4 };

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
    for (const id of byDistrict.keys()) if (!districts.find((d) => d.id === id)) districts.push({ id, name: id, hue: 200 });
    const showUnmapped = (board.unmapped?.files || 0) > 0;
    if (showUnmapped) {
      districts.push({ id: '_unmapped', name: 'Unclaimed', hue: 30 });
      byDistrict.set('_unmapped', [{ id: UNMAPPED, name: 'Unmapped files', files: board.unmapped.files, district: '_unmapped', about: 'Files no block claims.' }]);
    }
    for (const d of districts) {
      const blocks = byDistrict.get(d.id) || [];
      if (!blocks.length) continue;
      const order = [...blocks].sort((a, b) => UNITS[sizeOf(b)] - UNITS[sizeOf(a)]);
      const units = order.reduce((n, b) => n + UNITS[sizeOf(b)], 0);
      const cols = Math.max(2, Math.min(5, Math.round(Math.sqrt(units * 1.5))));
      const grid = h('div', { class: 'district-grid', style: { '--cols': cols } });
      const files = blocks.reduce((n, b) => n + (b.files || 0), 0);
      const el = h(
        'section',
        { class: 'district', style: { '--h': d.hue ?? 200 }, 'data-district': d.id, title: d.about || '' },
        h('div', { class: 'district-label' }, h('span', {}, d.name), h('span', {}, files ? `${blocks.length} blocks · ${files} files` : `${blocks.length} blocks`)),
        grid,
      );
      for (const b of order) {
        const size = sizeOf(b);
        const slot = h('div', { class: `slot s-${size}`, 'data-slot': b.id });
        grid.append(slot);
        slots.set(b.id, slot);
        const tile = tiles.get(b.id) || makeTile(b.id);
        tile.classList.remove('s-s', 's-m', 's-l');
        tile.classList.add(`s-${size}`);
        tile.classList.toggle('unmapped', b.id === UNMAPPED);
        const socket = h('div', { class: 'socket', 'data-socket': b.id, hidden: true }, h('div', { class: 'sk-name' }, b.name), h('div', { class: 'sk-who' }));
        socket.addEventListener('click', () => ctx.select(b.id));
        sockets.set(b.id, socket);
        slot.append(socket);
        slot.append(tile);
      }
      root.append(el);
    }
    for (const [id, tile] of tiles) if (!slots.has(id)) {
      tile.remove();
      tiles.delete(id);
    }
    fitKey = '';
  }

  // Scale the map down (not below 70%) until every district fits the space it has, so the whole
  // repository reads at a glance. Phones scroll instead.
  function fit() {
    const wrap = root.parentElement;
    const key = `${wrap.clientWidth}x${wrap.clientHeight}x${tiles.size}`;
    if (key === fitKey) return;
    fitKey = key;
    if (matchMedia('(max-width: 860px)').matches) {
      root.style.zoom = '';
      zoom = 1;
      return;
    }
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    let z = 1;
    for (; z > 0.7; z -= 0.03) {
      root.style.zoom = String(z);
      const r = root.getBoundingClientRect();
      if (r.height <= H + 1 && r.width <= W + 1) break;
    }
    zoom = Math.max(0.7, z);
    root.style.zoom = String(zoom);
  }

  function makeTile(id) {
    const tile = h(
      'div',
      { class: 'tile', 'data-block': id, tabindex: '0', role: 'button' },
      h('div', { class: 'tile-name' }),
      h('div', { class: 'tile-meta' }),
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
    for (const [id, tile] of tiles) {
      const meta = blockMeta(st, id) || { name: id };
      const b = st.blocks[id];
      if (!b) continue;
      const c = itemCounts(st, id);
      const hv = heat(b, now);
      const toucher = recentToucher(b, now, 40 * 60_000);
      const tc = toucher ? colorOf(st, toucher) : 'var(--ink-3)';
      const [nameEl, metaEl, badgesEl, feetEl, pulse] = tile.children;
      if (nameEl.textContent !== meta.name) nameEl.textContent = meta.name;
      const last = b.touches[b.touches.length - 1];
      const metaText = last && now - last.ts < 2 * 3600_000 ? `${ago(now - last.ts)} ago · ${agentName(st, last.agent)}` : meta.files !== undefined ? `${meta.files} files` : '';
      if (metaEl.textContent !== metaText) metaEl.textContent = metaText;

      let badges = '';
      if (b.queued && !b.holder) badges += `<span class="badge" title="Position in the queue">#${b.queued.pos ? queuePos(st, id) : ''}</span>`;
      if (c.bug) badges += `<span class="badge bug" title="${c.bug} open bug${c.bug > 1 ? 's' : ''}">${icon('bug')}${c.bug}</span>`;
      if (c.task) badges += `<span class="badge" title="${c.task} open task${c.task > 1 ? 's' : ''}">${icon('task')}${c.task}</span>`;
      if (c.decision + c.question) badges += `<span class="badge ask" title="${c.decision + c.question} waiting on ${esc(st.agents[HUMAN].name)}">${icon('decision')}${c.decision + c.question}</span>`;
      if (b.test && now - b.test.ts < 6 * 3600_000) badges += b.test.ok ? `<span class="badge ok" title="Tests passed ${ago(now - b.test.ts)} ago">${icon('check')}</span>` : `<span class="badge fail" title="Tests failing: ${esc(b.test.summary)}">${icon('cross')}</span>`;
      if (b.frozen) badges += `<span class="badge frozen" title="Frozen${b.frozen.note ? `: ${esc(b.frozen.note)}` : ''}">${icon('lock')}</span>`;
      const watchers = Object.keys(b.watchers);
      if (watchers.length) badges += `<span class="badge watch" title="Watched by ${watchers.map((w) => esc(agentName(st, w))).join(', ')}">${icon('eye')}${watchers.length}</span>`;
      setHtml(badgesEl, badges);

      const feet = footprints(b, now, 45 * 60_000).slice(0, 3);
      setHtml(feetEl, feet.map((a) => `<i style="--fc:${colorOf(st, a)}" title="${esc(agentName(st, a))} was here"></i>`).join(''));

      const hot = hv > 0.25;
      toggle(tile, 'hot', hot);
      pulse.hidden = !(hot && toucher && now - (last?.ts || 0) < 3 * 60_000);
      tile.style.setProperty('--tc', tc);
      tile.style.setProperty('--hp', `${Math.round(Math.min(85, 22 + hv * 22))}%`);
      let lv = 0;
      let lc = '';
      if (ctx.lens === 'heat') lv = Math.min(72, hv * 26);
      else if (ctx.lens === 'issues') lv = Math.min(62, (c.bug * 3 + c.task + (c.decision + c.question) * 2) * 3.2);
      else if (ctx.lens === 'history') {
        const prev = b.holder || b.history[b.history.length - 1]?.agent;
        if (prev) {
          lc = colorOf(st, prev);
          lv = b.holder ? 34 : 20;
        }
      }
      tile.style.setProperty('--lv', `${Math.round(lv)}%`);
      if (lc) tile.style.setProperty('--lc', lc);
      else tile.style.removeProperty('--lc');
      toggle(tile, 'frozen', !!b.frozen);
      toggle(tile, 'selected', ctx.selected === id);
      const matched = q ? q.matches.has(id) : false;
      toggle(tile, 'dim', !!q && !matched);
      toggle(tile, 'match', !!q && matched && q.exact);
      tile.title = `${meta.name}${b.holder ? ` · held by ${agentName(st, b.holder)}${b.intent ? `: ${b.intent}` : ''}` : ''}`;

      const socket = sockets.get(id);
      if (socket) paintSocket(st, now, socket, b);
    }
  }

  function paintSocket(st, now, socket, b) {
    const away = !!(b.holder || b.queued);
    socket.hidden = !away;
    if (!away) return;
    const who = socket.children[1];
    if (b.holder) {
      const a = st.agents[b.holder];
      const color = colorOf(st, b.holder);
      socket.style.setProperty('--sc', color);
      socket.classList.remove('queued');
      toggle(socket, 'stale', isStale(st, b.holder, now));
      setHtml(who, `<span class="dot">${esc(initials(a?.name))}</span><span>${esc(a?.name || b.holder)} · ${ago(now - b.since)}</span>`);
    } else {
      socket.style.removeProperty('--sc');
      socket.classList.add('queued');
      socket.classList.remove('stale');
      setHtml(who, `${icon('queue')}<span>Up next #${queuePos(st, b.id)}</span>`);
    }
  }

  return { build, paint, fit, tiles, slots, sockets, get zoom() { return zoom; } };
}

export function colorOf(st, agentId) {
  if (agentId === HUMAN) return 'var(--human)';
  return st.agents[agentId]?.color || 'var(--ink-3)';
}

function queuePos(st, id) {
  const q = Object.values(st.blocks).filter((b) => b.queued && !b.holder).sort((a, b) => a.queued.pos - b.queued.pos);
  return q.findIndex((b) => b.id === id) + 1;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
