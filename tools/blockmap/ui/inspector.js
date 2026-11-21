// The block inspector: what a block is, who holds it, its open items, its docs and paths, and what
// happened in it lately. Actions here write events, the same ones `bm` writes.

import { HUMAN, UNMAPPED, blockMeta, agentName, presence, ago, clock, ITEM_STATUS } from '../core/model.js';
import { h, icon, esc } from './dom.js';
import { colorOf } from './map.js';

const KIND_ICON = { bug: 'bug', task: 'task', decision: 'decision', question: 'question', note: 'note' };
const KIND_WORD = { bug: 'Bugs', task: 'Tasks', decision: 'Your call', question: 'Questions', note: 'Notes' };

export function createInspector(ctx, root, scrim) {
  let id = null;
  let kindFilter = 'all';
  let openItem = null;
  let sig = '';

  const head = h('div', { class: 'in-head' });
  const body = h('div', { class: 'in-body' });
  const itemsSec = h('div', { class: 'in-sec' });
  const addSec = h('div', { class: 'in-sec' });
  const staticSec = h('div', {});
  const actSec = h('div', { class: 'in-sec' });
  body.append(itemsSec, addSec, actSec, staticSec);
  root.append(head, body);

  const kindSel = h('select', { id: 'add-kind', 'aria-label': 'Kind' }, h('option', { value: 'bug' }, 'Bug'), h('option', { value: 'task' }, 'Task'));
  const addField = h('input', { class: 'field', id: 'add-title', placeholder: 'File a bug or task here…', autocomplete: 'off' });
  const addForm = h('form', { class: 'add-item' }, kindSel, addField, h('button', { class: 'btn', type: 'submit' }, 'Add'));
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = addField.value.trim();
    if (!title || !id) return;
    ctx.act.addItem({ kind: kindSel.value, title, block: id }).then((ok) => {
      if (ok) addField.value = '';
    });
  });
  addSec.append(addForm);

  scrim.addEventListener('click', () => close());

  function open(blockId) {
    if (id !== blockId) {
      kindFilter = 'all';
      openItem = null;
      body.scrollTop = 0;
    }
    id = blockId;
    sig = '';
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    scrim.classList.add('on');
    paintStatic();
    update();
  }

  function close() {
    id = null;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('on');
    ctx.selectQuiet(null);
  }

  function paintStatic() {
    const meta = blockMeta(ctx.view, id) || {};
    staticSec.textContent = '';
    if (meta.docs?.length) {
      staticSec.append(h('div', { class: 'in-sec' }, h('h3', {}, 'Read before touching it'), h('div', { class: 'docs' }, ...meta.docs.map((d) => h('div', {}, d)))));
    }
    if (meta.paths?.length) {
      staticSec.append(h('div', { class: 'in-sec' }, h('h3', {}, h('span', {}, 'Paths'), h('span', { class: 'mono' }, meta.files !== undefined ? `${meta.files} files · ${fmtKb(meta.kb)}` : '')), h('pre', { class: 'paths' }, meta.paths.join('\n'))));
    } else if (id === UNMAPPED && ctx.board.unmapped?.sample?.length) {
      staticSec.append(h('div', { class: 'in-sec' }, h('h3', {}, 'Some of them'), h('pre', { class: 'paths' }, ctx.board.unmapped.sample.join('\n'))));
    }
    if (ctx.mode !== 'demo') {
      staticSec.append(h('div', { class: 'in-sec' }, h('h3', {}, 'From a terminal'), h('pre', { class: 'paths' }, `tools/blockmap/bm show ${id}\ntools/blockmap/bm reserve ${id} --for "…"`)));
    }
  }

  function update() {
    if (!id) return;
    const st = ctx.view;
    const now = ctx.viewNow;
    const b = st.blocks[id];
    if (!b) return close();
    const meta = blockMeta(st, id) || { name: id };
    const items = Object.values(st.items).filter((it) => it.block === id);
    const next = JSON.stringify([id, b.holder, b.since, b.intent, b.queued, b.frozen, b.test, b.touches.length, b.history.length, items.map((i) => i.status + i.kind + i.title), kindFilter, openItem, ctx.replayTs ? Math.floor(now / 5000) : Math.floor(now / 30_000), Object.keys(st.agents).length]);
    if (next === sig) return;
    sig = next;

    const d = ctx.board.districts.find((x) => x.id === meta.district);
    root.style.setProperty('--h', d?.hue ?? 200);
    head.textContent = '';
    const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', html: icon('close') });
    closeBtn.addEventListener('click', close);
    head.append(h('div', { class: 'in-district' }, d?.name || 'Unclaimed'), h('div', { class: 'in-top' }, h('h2', { class: 'in-name' }, meta.name), closeBtn));
    if (meta.about) head.append(h('p', { class: 'in-about' }, meta.about));

    const stateLine = h('div', { class: 'in-state' });
    if (b.holder) {
      const a = st.agents[b.holder];
      const p = presence(st, b.holder, now);
      stateLine.append(
        h('span', { class: `pill ${b.holder === HUMAN ? 'idle' : p}`, style: { '--pc': colorOf(st, b.holder) } }, `${a?.name || b.holder}${b.holder === HUMAN ? ' (you)' : ''}`),
        h('span', {}, `since ${clock(b.since)}${b.intent ? `: ${b.intent}` : ''}`),
      );
    } else if (b.queued) stateLine.append(h('span', { class: 'pill idle' }, 'Up next'), h('span', {}, b.queued.note || 'Queued for the next free agent'));
    else stateLine.append(h('span', { class: 'pill idle' }, 'Free'), h('span', {}, 'Nobody holds it'));
    if (b.frozen) stateLine.append(h('span', { class: 'badge frozen', html: `${icon('lock')} Frozen${b.frozen.note ? `: ${esc(b.frozen.note)}` : ''}` }));
    if (b.test) stateLine.append(h('span', { class: `badge ${b.test.ok ? 'ok' : 'fail'}`, html: `${icon(b.test.ok ? 'check' : 'cross')} ${b.test.ok ? 'Tests pass' : 'Tests fail'}, ${ago(now - b.test.ts)} ago` }));
    head.append(stateLine);

    if (id !== UNMAPPED) {
      const actions = h('div', { class: 'in-actions' });
      const sel = h('select', { id: 'give-to', 'aria-label': 'Give this block to' }, h('option', { value: '' }, 'Give to…'));
      for (const a of Object.values(st.agents)) {
        if (a.leftAt || a.id === b.holder) continue;
        sel.append(h('option', { value: a.id }, a.id === HUMAN ? `${a.name} (keep it)` : `${a.name} · ${presence(st, a.id, now)}`));
      }
      sel.addEventListener('change', () => sel.value && ctx.act.assign(id, sel.value));
      actions.append(sel);
      if (b.holder) actions.append(button('Release', () => ctx.act.release(id)));
      if (!b.holder) actions.append(b.queued ? button('Take off the queue', () => ctx.act.unqueue(id)) : button('Queue it', () => ctx.act.queue(id)));
      actions.append(b.frozen ? button('Unfreeze', () => ctx.act.freeze(id, false)) : button('Freeze', () => ctx.act.freeze(id, true), 'Agents can’t reserve or edit a frozen block'));
      if (ctx.replayTs) for (const el of actions.querySelectorAll('button,select')) el.disabled = true;
      head.append(actions);
    }

    paintItems(st, items);
    paintActivity(st, b);
  }

  function paintItems(st, items) {
    itemsSec.textContent = '';
    const open = items.filter((it) => it.status !== 'done' && it.status !== 'wontfix');
    const done = items.filter((it) => it.status === 'done' || it.status === 'wontfix');
    const kinds = ['bug', 'task', 'decision', 'question'].filter((k) => open.some((it) => it.kind === k));
    itemsSec.append(h('h3', {}, h('span', {}, 'Open items'), h('span', { class: 'mono' }, `${open.length} open${done.length ? ` · ${done.length} done` : ''}`)));
    if (kinds.length > 1) {
      const chips = h('div', { class: 'chips' });
      for (const k of ['all', ...kinds]) {
        const n = k === 'all' ? open.length : open.filter((it) => it.kind === k).length;
        const c = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(kindFilter === k) }, `${k === 'all' ? 'All' : KIND_WORD[k]} ${n}`);
        c.addEventListener('click', () => {
          kindFilter = k;
          sig = '';
          update();
        });
        chips.append(c);
      }
      itemsSec.append(chips);
    }
    const shown = [...open.filter((it) => kindFilter === 'all' || it.kind === kindFilter), ...(kindFilter === 'all' ? done.slice(-5) : [])];
    if (!shown.length) itemsSec.append(h('p', { class: 'in-about' }, 'Nothing open here.'));
    const list = h('ul', { class: 'items' });
    const order = { question: 0, bug: 1, decision: 2, task: 3, note: 4 };
    shown.sort((a, b) => (a.status === 'done') - (b.status === 'done') || order[a.kind] - order[b.kind]);
    for (const it of shown.slice(0, 60)) {
      const sel = h('select', { 'aria-label': `Status of ${it.id}` }, ...ITEM_STATUS.map((s) => h('option', { value: s, selected: s === it.status }, s)));
      sel.addEventListener('change', () => ctx.act.updateItem(it.id, { status: sel.value }));
      sel.disabled = !!ctx.replayTs;
      const sub = [it.id, it.status !== 'open' ? it.status : '', it.source === 'import' ? it.group : `filed by ${agentName(st, it.by)}`, it.answer ? `answer: ${it.answer}` : ''].filter(Boolean).join(' · ');
      const titleEl = h('div', { class: 'it-title' }, it.title);
      const textCol = h('div', { style: { minWidth: 0, cursor: it.detail ? 'pointer' : 'default' } }, titleEl, h('div', { class: 'it-sub', title: sub }, sub));
      if (openItem === it.id && it.detail) textCol.append(h('div', { class: 'it-detail' }, it.detail, it.ref ? h('div', { class: 'it-sub' }, it.ref) : null));
      textCol.addEventListener('click', () => {
        openItem = openItem === it.id ? null : it.id;
        sig = '';
        update();
      });
      list.append(h('li', { class: `item k-${it.kind} s-${it.status}` }, h('span', { html: icon(it.status === 'done' ? 'done' : KIND_ICON[it.kind] || 'task') }), textCol, sel));
    }
    itemsSec.append(list);
  }

  function paintActivity(st, b) {
    actSec.textContent = '';
    const touches = b.touches.slice(-10).reverse();
    const hist = b.history.slice(-6).reverse();
    if (!touches.length && !hist.length) return;
    if (touches.length) {
      actSec.append(h('h3', {}, 'Recent activity'));
      const list = h('ul', { class: 'acts' });
      for (const t of touches) list.append(h('li', {}, h('time', {}, clock(t.ts)), h('i', { style: { '--fc': colorOf(st, t.agent) } }), h('span', { class: 't', title: `${agentName(st, t.agent)} ${t.op} ${t.file}` }, `${agentName(st, t.agent)} ${t.op === 'read' ? 'read' : 'edited'} ${t.file}`)));
      actSec.append(list);
    }
    if (hist.length) {
      actSec.append(h('h3', { style: { marginTop: '10px' } }, 'Who held it'));
      const list = h('ul', { class: 'acts' });
      for (const x of hist) list.append(h('li', {}, h('time', {}, clock(x.from)), h('i', { style: { '--fc': colorOf(st, x.agent) } }), h('span', { class: 't' }, `${agentName(st, x.agent)} for ${ago(x.to - x.from)}, ${x.outcome}${x.intent ? `: ${x.intent}` : ''}`)));
      actSec.append(list);
    }
  }

  function button(label, fn, title) {
    const b = h('button', { class: 'btn', type: 'button', title }, label);
    b.addEventListener('click', fn);
    return b;
  }

  return { open, close, update, get id() { return id; } };
}

function fmtKb(kb) {
  if (kb === undefined) return '';
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}
