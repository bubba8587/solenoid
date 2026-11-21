// The lines from each held block's empty socket on the map to the tile in its holder's window.

import { presence } from '../core/model.js';
import { colorOf } from './map.js';

export function createTethers(ctx, svg, mapWrap, side) {
  let frame = 0;

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
      const sx = s.right - 4;
      const sy = s.top + s.height / 2;
      let ex = t.left + 2;
      const ey = t.top + t.height / 2;
      // Only tethers whose both ends are on screen: a line to somewhere you can't see is noise.
      if (sy < mapBox.top + 4 || sy > mapBox.bottom - 4 || sx > mapBox.right) continue;
      if (ey < sideBox.top + 4 || ey > sideBox.bottom - 4) continue;
      ex = Math.max(ex, sideBox.left + 2);
      const dx = Math.max(40, (ex - sx) * 0.5);
      const color = colorOf(st, b.holder);
      const working = presence(st, b.holder, now) === 'working';
      parts.push(`<path class="${working ? 'working' : ''}" d="M${sx} ${sy} C${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}" stroke="${color}"/>`);
      parts.push(`<circle cx="${sx}" cy="${sy}" r="3.2" fill="${color}"/>`);
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

  mapWrap.addEventListener('scroll', schedule, { passive: true });
  side.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  return { draw: schedule, follow };
}
