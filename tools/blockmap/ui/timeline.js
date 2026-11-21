// The timeline dock: a lane per agent showing which blocks it held when, its edits, tests and
// questions, and the human's own actions. Dragging across it replays the board at that moment.

import { HUMAN, blockMeta, clock } from '../core/model.js';
import { h, icon, setHtml, setText, esc, storageGet, storageSet } from './dom.js';
import { colorOf, inkOf } from './map.js';

const RANGES = [
  ['1h', 3600_000],
  ['3h', 3 * 3600_000],
  ['12h', 12 * 3600_000],
  ['All', Infinity],
];
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720].map((m) => m * 60_000);
const LABEL = 92;
const AXIS = 20;
const ROW = 13;
const PAD_R = 14;

export function createTimeline(ctx, root) {
  let range = 3 * 3600_000;
  let playing = null;
  const time = h('span', { class: 'tl-time', hidden: true });
  const live = h('button', { class: 'btn', type: 'button', hidden: true }, 'Live');
  const play = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Replay', html: icon('play') });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' });
  for (const [label, ms] of RANGES) {
    const b = h('button', { type: 'button', 'aria-pressed': String(ms === range) }, label);
    b.addEventListener('click', () => {
      range = ms;
      for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b));
      update(true);
    });
    seg.append(b);
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tl-svg');
  const body = h('div', { class: 'tl-body' }, svg);
  // Folded, the timeline keeps its controls and gives its height to the map; short screens start folded.
  let folded = storageGet('blockmap.timelineFolded', window.innerHeight < 800);
  const fold = h('button', { class: 'icon-btn tl-fold', type: 'button' });
  const applyFold = () => {
    body.hidden = folded;
    root.classList.toggle('folded', folded);
    fold.innerHTML = icon('chev');
    fold.setAttribute('aria-label', folded ? 'Show the timeline' : 'Hide the timeline');
    fold.setAttribute('aria-expanded', String(!folded));
  };
  fold.addEventListener('click', () => {
    folded = !folded;
    storageSet('blockmap.timelineFolded', folded);
    applyFold();
    if (!folded) update(true);
    ctx.render?.();
  });
  applyFold();
  root.append(h('div', { class: 'tl-head' }, play, seg, time, live, fold), body);

  live.addEventListener('click', () => {
    stop();
    ctx.replay(null);
  });
  play.addEventListener('click', () => (playing ? stop() : start()));

  let geom = null;
  let dragging = false;
  svg.addEventListener('pointerdown', (e) => {
    if (!geom) return;
    stop();
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    scrub(e);
  });
  svg.addEventListener('pointermove', (e) => dragging && scrub(e));
  svg.addEventListener('pointerup', () => (dragging = false));
  svg.addEventListener('pointercancel', () => (dragging = false));

  function scrub(e) {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * geom.W;
    const t = geom.t0 + ((x - LABEL) / (geom.W - LABEL - PAD_R)) * (geom.t1 - geom.t0);
    if (t >= geom.t1 - (geom.t1 - geom.t0) * 0.012) ctx.replay(null);
    else ctx.replay(Math.max(geom.t0, t));
  }

  function start() {
    const g = geom;
    if (!g) return;
    let t = ctx.replayTs ?? g.t0;
    if (t >= g.t1 - 1000) t = g.t0;
    const speed = (g.t1 - g.t0) / 22_000;
    let last = performance.now();
    play.innerHTML = icon('pause');
    play.setAttribute('aria-label', 'Pause');
    const times = ctx.events.map((e) => e.ts);
    const tick = (nowPerf) => {
      t += (nowPerf - last) * speed;
      last = nowPerf;
      // Skip stretches where nothing happened, as Gource does, so a replay never plays silence.
      const next = times.find((x) => x > t);
      if (next && next - t > speed * 1500) t = next - speed * 300;
      if (t >= g.t1) {
        stop();
        ctx.replay(null);
        return;
      }
      ctx.replay(t);
      playing = requestAnimationFrame(tick);
    };
    playing = requestAnimationFrame(tick);
  }

  function stop() {
    if (playing) cancelAnimationFrame(playing);
    playing = null;
    play.innerHTML = icon('play');
    play.setAttribute('aria-label', 'Replay');
  }

  let cacheKey = '';
  function update(force = false) {
    const st = ctx.live;
    const events = ctx.events;
    const liveNow = ctx.liveNow();
    const W = Math.max(640, Math.round(body.clientWidth || 900));
    const firstTs = events.length ? events[0].ts : liveNow - 3600_000;
    const t1 = liveNow;
    const t0 = Math.max(t1 - range, firstTs - Math.max(20_000, (t1 - firstTs) * 0.06));
    const viewTs = ctx.replayTs ?? t1;
    setText(time, clock(viewTs));
    time.hidden = !ctx.replayTs;
    live.hidden = !ctx.replayTs;
    const key = `${events.length}|${W}|${Math.floor(t1 / 15_000)}|${range}|${document.documentElement.dataset.theme || ''}`;
    if (key !== cacheKey || force) {
      cacheKey = key;
      draw(st, events, t0, t1, W);
    }
    placeHead(viewTs);
  }

  function draw(st, events, t0, t1, W) {
    const x = (t) => LABEL + ((t - t0) / (t1 - t0)) * (W - LABEL - PAD_R);
    const holds = [];
    for (const b of Object.values(st.blocks)) {
      for (const hst of b.history) if (hst.to >= t0) holds.push({ block: b.id, agent: hst.agent, from: hst.from, to: hst.to });
      if (b.holder) holds.push({ block: b.id, agent: b.holder, from: b.since, to: null });
    }
    const first = new Map();
    for (const e of events) {
      if (e.ts < t0) continue;
      const who = typeof e.agent === 'string' ? e.agent : e.by;
      if (who && who !== HUMAN && !first.has(who)) first.set(who, e.ts);
    }
    for (const hd of holds) if (!first.has(hd.agent)) first.set(hd.agent, hd.from);
    const lanes = [...first.keys()].filter((id) => st.agents[id] && id !== HUMAN).sort((a, b) => first.get(a) - first.get(b));
    if (first.has(HUMAN)) lanes.push(HUMAN);

    // Holds that overlap in one lane stack in sub-rows, so no label prints over another.
    const rowsOf = new Map();
    for (const id of lanes) {
      const mine = holds.filter((hd) => hd.agent === id).sort((a, b) => a.from - b.from);
      const ends = [];
      for (const hd of mine) {
        let r = ends.findIndex((end) => end <= hd.from);
        if (r < 0) r = ends.length;
        ends[r] = hd.to ?? Infinity;
        hd.row = r;
      }
      rowsOf.set(id, Math.max(1, ends.length));
    }
    const laneY = new Map();
    let y = AXIS;
    for (const id of lanes) {
      laneY.set(id, y);
      y += 6 + rowsOf.get(id) * ROW;
    }
    const H = y + 4;
    geom = { W, H, t0, t1 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.height = `${H}px`;

    const parts = [];
    lanes.forEach((id, i) => {
      const ly = laneY.get(id);
      const lh = 6 + rowsOf.get(id) * ROW;
      if (i % 2 === 0) parts.push(`<rect class="lane" x="0" y="${ly}" width="${W}" height="${lh}"/>`);
      parts.push(`<circle cx="10" cy="${ly + 3 + ROW / 2}" r="4" fill="${colorOf(st, id)}"/><text class="lane-label" x="20" y="${ly + 3 + ROW / 2 + 4}">${esc(st.agents[id].name.slice(0, 11))}</text>`);
    });
    const span = t1 - t0;
    const step = STEPS.find((sv) => span / sv <= 8) || STEPS[STEPS.length - 1];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const tx = x(t);
      const label = tx < W - PAD_R - 34 ? `<text class="tick-label" x="${tx + 3}" y="${AXIS - 7}">${clock(t)}</text>` : '';
      parts.push(`<line class="tick" x1="${tx}" x2="${tx}" y1="${AXIS - 4}" y2="${H}"/>${label}`);
    }
    for (const hd of holds) {
      const ly = laneY.get(hd.agent);
      if (ly === undefined) continue;
      const by = ly + 4 + hd.row * ROW;
      const x0 = Math.max(LABEL, x(hd.from));
      const w = Math.max(2, x(hd.to ?? t1) - x0);
      const name = blockMeta(st, hd.block)?.name || hd.block;
      // A finished hold is a tint of its agent's color with ordinary ink; the current one is the color itself.
      const fill = hd.to ? `color-mix(in srgb, ${colorOf(st, hd.agent)} 32%, var(--surface))` : colorOf(st, hd.agent);
      const ink = hd.to ? 'var(--text)' : inkOf(st, hd.agent);
      parts.push(`<g class="hold"><rect x="${x0}" y="${by}" width="${w}" height="${ROW - 2}" rx="2" style="fill:${fill}"><title>${esc(name)}: ${clock(hd.from)} to ${hd.to ? clock(hd.to) : 'now'}</title></rect>${w > 40 ? `<text x="${x0 + 4}" y="${by + ROW / 2 + 2}" style="fill:${ink}">${esc(fit(name, w))}</text>` : ''}</g>`);
    }
    // Only what asks for attention gets a mark: a failing test (red) and a question for the human (gold), above the bars.
    for (const e of events) {
      if (e.ts < t0) continue;
      const who = typeof e.agent === 'string' ? e.agent : e.by;
      const ly = laneY.get(who);
      if (ly === undefined) continue;
      const ex = x(e.ts);
      if (e.type === 'test' && !e.ok) parts.push(`<circle class="mk-fail" cx="${ex}" cy="${ly + 2}" r="2.4"><title>${esc(e.summary || 'Tests fail')}</title></circle>`);
      else if (e.type === 'item.add' && e.item?.kind === 'question') parts.push(`<path class="mk-ask" d="M${ex} ${ly - 1} l3 3 -3 3 -3 -3Z"><title>${esc(e.item.title)}</title></path>`);
    }
    parts.push(`<line class="now-line" x1="${x(t1)}" x2="${x(t1)}" y1="${AXIS - 4}" y2="${H}"/>`);
    parts.push(`<rect class="past" id="tl-future" x="0" y="${AXIS - 4}" width="0" height="${H}"/>`);
    parts.push(`<g id="tl-head"><line class="head-line" x1="0" x2="0" y1="${AXIS - 6}" y2="${H}"/><circle class="head-knob" cx="0" cy="${AXIS - 6}" r="4"/></g>`);
    setHtml(svg, parts.join(''));
    geom.x = x;
  }

  function placeHead(ts) {
    if (!geom?.x) return;
    const hx = geom.x(Math.min(ts, geom.t1));
    const head = svg.querySelector('#tl-head');
    const fut = svg.querySelector('#tl-future');
    if (head) head.setAttribute('transform', `translate(${hx} 0)`);
    if (fut) {
      fut.setAttribute('x', String(hx));
      fut.setAttribute('width', String(ctx.replayTs ? Math.max(0, geom.x(geom.t1) - hx) : 0));
    }
  }

  return {
    update,
    stop,
    playFrom(ts) {
      stop();
      ctx.replay(ts);
      start();
    },
  };
}

function fit(text, w) {
  const max = Math.floor((w - 8) / 5.4);
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}
