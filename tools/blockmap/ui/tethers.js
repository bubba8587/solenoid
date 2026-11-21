// The lines from each held block's socket on the map to its holder's window. They stay faint and stop at the
// window's edge, so they never cross a window's contents; hovering an agent's window or socket brings its out.

import { presence } from '../core/model.js';
import { colorOf } from './map.js';

export function createTethers(ctx, svg, mapWrap, side) {
  let frame = 0;
  let hot = null;

  function draw() {
    frame = 0;
    if (getComputedStyle(svg).display === 'none') return;
    const st = ctx.view;
    const now = ctx.viewNow;
    const mapBox = mapWrap.getBoundingClientRect();
    const sideBox = side.getBoundingClientRect();
    const parts = [];
    for (const b of Object.values(st.blocks)) {
      if (!b.holder) continue;
      const socket = ctx.map.sockets.get(b.id);
      const tile = ctx.map.tiles.get(b.id);
      if (!socket || !tile || socket.hidden || !tile.closest('.tray')) continue;
      const s = socket.getBoundingClientRect();
      const t = tile.getBoundingClientRect();
      if (!s.width || !t.width) continue;
      const sx = s.right - 3;
      const sy = s.top + s.height / 2;
      const ex = sideBox.left - 1;
      const ey = t.top + t.height / 2;
      if (sy < mapBox.top + 4 || sy > mapBox.bottom - 4 || sx > mapBox.right) continue;
      if (ey < sideBox.top + 4 || ey > sideBox.bottom - 4) continue;
      const dx = Math.max(30, (ex - sx) * 0.5);
      const cls = [presence(st, b.holder, now) === 'working' ? 'working' : '', hot === b.holder ? 'hot' : ''].join(' ').trim();
      const color = colorOf(st, b.holder);
      parts.push(`<path class="${cls}" d="M${sx} ${sy} C${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}" stroke="${color}"/>`);
      parts.push(`<circle cx="${sx}" cy="${sy}" r="2.6" fill="${color}"/>`);
    }
    const html = parts.join('');
    if (svg.__html !== html) {
      svg.innerHTML = html;
      svg.__html = html;
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  // Follow tiles while they fly between the map and a window.
  function follow(ms = 650) {
    const until = performance.now() + ms;
    const loop = () => {
      draw();
      if (performance.now() < until) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  const hover = (e) => {
    const win = e.target.closest?.('.win[data-win]');
    const sock = e.target.closest?.('.socket[data-socket]');
    const next = win ? win.dataset.win : sock ? ctx.view?.blocks[sock.dataset.socket]?.holder || null : null;
    if (next !== hot) {
      hot = next;
      schedule();
    }
  };
  document.addEventListener('pointerover', hover);
  mapWrap.addEventListener('scroll', schedule, { passive: true });
  side.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  return { draw: schedule, follow };
}
