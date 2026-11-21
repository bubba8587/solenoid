// Dragging tiles between the map, the agent windows and the queue. Pointer events, so a mouse
// drags at once and a finger drags after a long press (a plain swipe still scrolls the page).

export function enableDnd(ctx) {
  let press = null;
  let ghost = null;
  let over = null;

  const dist = (e) => Math.hypot(e.clientX - press.x, e.clientY - press.y);

  document.addEventListener('pointerdown', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile || e.button !== 0 || e.target.closest('input,button,select,textarea')) return;
    press = { id: tile.dataset.block, x: e.clientX, y: e.clientY, el: tile, touch: e.pointerType !== 'mouse', armed: e.pointerType === 'mouse', dragging: false };
    if (press.touch) {
      press.timer = setTimeout(() => {
        if (!press) return;
        press.armed = true;
        begin(e);
        try {
          navigator.vibrate?.(8);
        } catch {
          // No vibration here.
        }
      }, 340);
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (!press) return;
    if (!press.dragging) {
      if (press.touch && !press.armed && dist(e) > 9) return cancel();
      if (!press.touch && dist(e) > 5) begin(e);
      return;
    }
    move(e);
  });

  // Once a finger drag is armed, the page must not scroll under it.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (press?.dragging) e.preventDefault();
    },
    { passive: false },
  );

  document.addEventListener('pointerup', (e) => {
    if (!press) return;
    if (press.dragging) drop(e);
    else if (dist(e) < 8) ctx.select(press.id);
    cancel();
  });
  document.addEventListener('pointercancel', () => press && !press.dragging && cancel());

  function begin(e) {
    if (ctx.replayTs) {
      ctx.toast('Back to live to move blocks.');
      return cancel();
    }
    const st = ctx.view.blocks[press.id];
    if (!st || press.id.startsWith('_')) return cancel();
    if (st.frozen) {
      ctx.toast('Frozen. Unfreeze it in its details first.');
      return cancel();
    }
    press.dragging = true;
    ghost = press.el.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.classList.remove('selected', 'dim', 'match');
    ghost.removeAttribute('tabindex');
    document.body.append(ghost);
    press.el.classList.add('dragging');
    document.body.classList.add('dragging-tile');
    move(e);
  }

  function move(e) {
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    const target = targetAt(e.clientX, e.clientY);
    if (target !== over) {
      over?.el.classList.remove('drop-ok');
      over = target;
      over?.el.classList.add('drop-ok');
    }
  }

  function targetAt(x, y) {
    ghost.hidden = true;
    const el = document.elementFromPoint(x, y)?.closest('[data-drop]');
    ghost.hidden = false;
    if (!el) return null;
    // The person's window has two drop zones (hold it, or up next), each lit on its own.
    const box = el.classList.contains('tray') && el.closest('.you') ? el : el.closest('.win') || el;
    return { kind: el.dataset.drop, el: box };
  }

  function drop(e) {
    const target = targetAt(e.clientX, e.clientY);
    const id = press.id;
    const b = ctx.view.blocks[id];
    if (!target) return;
    if (target.kind === 'map') {
      if (b.holder) ctx.act.release(id);
      else if (b.queued) ctx.act.unqueue(id);
    } else if (target.kind === 'queue') {
      if (!b.queued || b.holder) ctx.act.queue(id);
    } else if (target.kind.startsWith('agent:')) {
      const agent = target.kind.slice(6);
      if (b.holder !== agent) ctx.act.assign(id, agent);
    }
  }

  function cancel() {
    if (press?.timer) clearTimeout(press.timer);
    press?.el.classList.remove('dragging');
    ghost?.remove();
    ghost = null;
    over?.el.classList.remove('drop-ok');
    over = null;
    document.body.classList.remove('dragging-tile');
    press = null;
  }

  return { get active() { return !!press?.dragging; } };
}
