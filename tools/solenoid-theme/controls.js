// The palette system's controls, ported from Solenoid's React components to plain DOM. They keep Solenoid's class
// names, so controls.css (generated from Solenoid's own stylesheets) draws them exactly as the app does:
//
//   appTools()        AppToolbar.tsx: the pill (the accent picker and the light/dark toggle) and round tool buttons
//   swatchGrid()      SwatchGrid.tsx: the twelve slots as discs, the gray one cycling white, gray and dark
//   openSettings()    Settings.tsx's dialog, Appearance first (palette, Edit custom…, accent), then the host's rows
//   the editor        PaletteEditor.tsx: the Custom palette, opened by Edit custom… (paletteEditorPanel)
//   initTheme()       initAppTheme, plus the slot variables and the phone flag the controls read
//
// The accent is a slot id, never a hex, as everywhere in the system; the stores in core/ do the work and these
// only show and set them.

import { appThemeStore, initAppTheme } from './core/appTheme.js';
import {
  paletteStore, paletteEditorPanel, PALETTE, COLOR_PALETTE, BUILTIN_PALETTES, BUILTIN_CHROME, DEFAULT_CHROME,
  resolveColor, resolveAccent, neutralHex, NEUTRAL_WHITE, NEUTRAL_DARK, isNeutralShade, nextNeutral,
  chromeCssVars, hexToRgba, contrastInk, themeAccent, darkenAccent,
} from './core/palette.js';

// Lucide icons (ISC) and Solenoid's own glyphs, as drawn in AppToolbar.tsx, PaintbrushIcon.tsx, CloseIcon.tsx and Settings.tsx.
export const ICONS = {
  paintbrush: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>',
  moon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z"/></svg>',
  sun: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13"/></svg>',
  caret: '<svg class="solenoid-settings__select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="display:block" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
};

// Solenoid's names for its slots' roles (PaletteEditor.tsx). A host whose slots mean other things passes its own.
export const SOLENOID_SLOT_ROLES = [
  { slot: 'gold', label: 'Number' },
  { slot: 'lime', label: 'Text' },
  { slot: 'pink', label: 'Date' },
  { slot: 'sky', label: 'Complex' },
  { slot: 'purple', label: 'Logical' },
  { slot: 'violet', label: 'Frame and Cube' },
  { slot: 'green', label: 'Lambda and Chart' },
  { slot: 'amber', label: 'Input' },
  { slot: 'blue', label: 'Math' },
  { slot: 'teal', label: 'Convert' },
  { slot: 'vermilion', label: 'Error' },
  { slot: 'gray', label: 'Any' },
];

const CHROME_ROLES = [
  { key: 'canvasBg', label: 'Canvas' },
  { key: 'canvasDot', label: 'Dots' },
  { key: 'appBg', label: 'Window' },
  { key: 'surface', label: 'Card' },
  { key: 'surfaceSunken', label: 'Field' },
  { key: 'surfaceRaised', label: 'Hover fill' },
  { key: 'border', label: 'Border' },
  { key: 'borderStrong', label: 'Border, strong' },
  { key: 'borderSubtle', label: 'Border, subtle' },
  { key: 'text', label: 'Text' },
  { key: 'textBright', label: 'Text, bright' },
  { key: 'textDim', label: 'Text, dim' },
  { key: 'textMuted', label: 'Text, muted' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return node;
}

// ------------------------------------------------------------------------------------------ swatches

// An SVG disc, never a CSS border-radius button, which clips a side at a time on fractional device pixels
// under zoom. The ring's inner edge overlaps the disc, so no hairline of panel shows between them.
function swatchSvg(color, on) {
  return `<svg width="16" height="16" viewBox="-1 -1 18 18" style="overflow:visible;display:block" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="${esc(color)}"/>${on ? '<circle cx="8" cy="8" r="8.6" fill="none" stroke="var(--text)" stroke-width="1.8"/>' : ''}</svg>`;
}

// One disc split into three diagonal bands (white, palette gray, dark), with the same padded viewBox.
function neutralSvg(on, clipId) {
  return `<svg width="16" height="16" viewBox="-1 -1 18 18" style="overflow:visible;display:block" aria-hidden="true"><defs><clipPath id="${clipId}"><circle cx="8" cy="8" r="8"/></clipPath></defs><g clip-path="url(#${clipId})"><rect x="0" y="0" width="16" height="16" fill="${esc(neutralHex('gray'))}"/><polygon points="0,0 12.5,0 0,12.5" fill="${esc(neutralHex(NEUTRAL_WHITE))}"/><polygon points="16,3.5 16,16 3.5,16" fill="${esc(neutralHex(NEUTRAL_DARK))}"/></g><circle cx="8" cy="8" r="8" fill="none" stroke="var(--border)" stroke-width="1"/>${on ? '<circle cx="8" cy="8" r="8.6" fill="none" stroke="var(--text)" stroke-width="1.8"/>' : ''}</svg>`;
}

let clipSeq = 0;

// The twelve slots. `value` and `onPick` deal in slot ids; the gray slot cycles white, gray and dark.
export function swatchGrid({ value, onPick, colors = COLOR_PALETTE, className = '' } = {}) {
  const root = el('div', { class: `solenoid-swatchgrid${className ? ` ${className}` : ''}` });
  const clipId = `sol-neutral-${++clipSeq}`;
  let current = value;
  function render() {
    const neutralOn = current === 'gray' || isNeutralShade(current ?? '');
    root.innerHTML = colors
      .map((slot) => {
        const gray = slot === 'gray';
        const title = gray ? 'Neutral: cycles white / gray / dark.' : slot;
        const on = gray ? neutralOn : slot === current;
        return `<button type="button" class="solenoid-swatchgrid__opt" data-slot="${esc(slot)}" title="${esc(title)}" aria-label="${esc(title)}" aria-pressed="${on}">${gray ? neutralSvg(neutralOn, clipId) : swatchSvg(resolveColor(slot), on)}</button>`;
      })
      .join('');
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (b) onPick?.(b.dataset.slot === 'gray' ? nextNeutral(current) : b.dataset.slot);
  });
  render();
  const off = paletteStore.subscribe(render);
  return {
    el: root,
    set(v) {
      if (v === current) return;
      current = v;
      render();
    },
    destroy: off,
  };
}

// ------------------------------------------------------------------------------------- the tool pill

export function toolButton({ title, label = title, icon, onClick, className = '' }) {
  const b = el('button', { type: 'button', class: `solenoid-apptools__btn${className ? ` ${className}` : ''}`, title, 'aria-label': label, html: icon });
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// The accent picker and the light/dark toggle share one pill, followed by the host's round tool buttons. The
// picker opens the swatches under the pill; on a phone (html.is-mobile) the toggle moves into that popup.
export function appTools({ buttons = [] } = {}) {
  const root = el('div', { class: 'solenoid-apptools' });
  const pill = el('div', { class: 'solenoid-apptools__pill' });
  const paint = el('button', { type: 'button', class: 'solenoid-apptools__btn solenoid-apptools__paint', title: 'Accent color', 'aria-label': 'Accent color', 'aria-expanded': 'false', html: ICONS.paintbrush });
  const dot = el('span', { class: 'solenoid-apptools__paint-dot' });
  paint.append(dot);
  const theme = el('button', { type: 'button', class: 'solenoid-apptools__btn solenoid-apptools__theme', 'aria-label': 'Toggle light and dark theme' });
  pill.append(paint, theme);
  root.append(pill, ...buttons);

  let popup = null;
  let grid = null;
  let phoneTheme = null;
  function open() {
    grid = swatchGrid({ value: appThemeStore.getAccent(), onPick: (c) => appThemeStore.setAccent(c) });
    phoneTheme = el('button', { type: 'button', class: 'solenoid-apptools__palette-theme' });
    phoneTheme.addEventListener('click', () => appThemeStore.toggleMode());
    popup = el('div', { class: 'solenoid-apptools__palette' }, grid.el, phoneTheme);
    pill.insertBefore(popup, theme);
    paint.setAttribute('aria-expanded', 'true');
    paintState();
  }
  function close() {
    if (!popup) return;
    grid.destroy();
    popup.remove();
    popup = grid = phoneTheme = null;
    paint.setAttribute('aria-expanded', 'false');
  }
  paint.addEventListener('click', () => (popup ? close() : open()));
  theme.addEventListener('click', () => appThemeStore.toggleMode());
  const outside = (e) => {
    if (popup && !paint.contains(e.target) && !popup.contains(e.target)) close();
  };
  const escape = (e) => {
    if (popup && e.key === 'Escape') close();
  };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape);

  function paintState() {
    const mode = appThemeStore.getMode();
    dot.style.background = resolveAccent(appThemeStore.getAccent());
    theme.title = mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    theme.innerHTML = mode === 'dark' ? ICONS.moon : ICONS.sun;
    if (grid) grid.set(appThemeStore.getAccent());
    if (phoneTheme) phoneTheme.innerHTML = `${mode === 'dark' ? ICONS.moon : ICONS.sun}<span>${mode === 'dark' ? 'Light mode' : 'Dark mode'}</span>`;
  }
  const off = appThemeStore.subscribe(paintState);
  paintState();
  return {
    el: root,
    close,
    destroy() {
      close();
      off();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    },
  };
}

// ------------------------------------------------------------------------------------------- dialogs

// A dialog layer: Solenoid's overlay fills its app's box, so here a fixed layer gives it the viewport.
function modal({ label, panelClass = '', onClose }) {
  const before = document.activeElement;
  const layer = el('div', { class: 'sol-kit-layer' });
  const overlay = el('div', { class: 'solenoid-settings' });
  const panel = el('div', { class: `solenoid-settings__panel${panelClass ? ` ${panelClass}` : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' });
  overlay.append(panel);
  layer.append(overlay);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) onClose();
  });
  // Escape closes the topmost dialog only; Tab stays inside it.
  layer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      const items = [...panel.querySelectorAll('button, select, input, [href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  const header = (title) => {
    const close = el('button', { type: 'button', class: 'solenoid-settings__close', 'aria-label': 'Close', html: ICONS.close });
    close.addEventListener('click', onClose);
    return el('div', { class: 'solenoid-settings__header' }, el('span', { class: 'solenoid-settings__title' }, title), close);
  };
  document.body.append(layer);
  return {
    layer,
    panel,
    header,
    remove() {
      layer.remove();
      if (before && document.contains(before)) before.focus?.();
    },
  };
}

// A Settings row with Solenoid's switch; the whole row toggles, as in Settings.tsx.
export function switchRow({ label, help, get, set }) {
  const knob = el('span', { class: 'solenoid-settings__knob' });
  const sw = el('button', { type: 'button', class: 'solenoid-settings__switch', role: 'switch', 'aria-label': label }, knob);
  const row = el('div', { class: 'solenoid-settings__row' }, el('span', { class: 'solenoid-settings__row-text' }, el('span', { class: 'solenoid-settings__row-label' }, label), help ? el('span', { class: 'solenoid-settings__row-help' }, help) : null), sw);
  const paint = () => {
    const on = !!get();
    sw.classList.toggle('solenoid-settings__switch--on', on);
    sw.setAttribute('aria-checked', String(on));
  };
  row.addEventListener('click', async () => {
    await set(!get());
    paint();
  });
  paint();
  return row;
}

function appearanceSection() {
  const select = el('select', { class: 'solenoid-settings__select', 'aria-label': 'Color palette' }, ...paletteStore.names().map((n) => el('option', { value: n }, n)), el('option', { value: 'Custom' }, 'Custom'));
  select.addEventListener('change', () => paletteStore.setActiveBase(select.value));
  const edit = el('button', { type: 'button', class: 'solenoid-settings__palette-edit' }, 'Edit custom…');
  edit.addEventListener('click', () => paletteEditorPanel.open());
  const grid = swatchGrid({ value: appThemeStore.getAccent(), onPick: (c) => appThemeStore.setAccent(c) });
  const wrap = el('span', { class: 'solenoid-settings__select-wrap' }, select);
  wrap.insertAdjacentHTML('beforeend', ICONS.caret);
  const section = el(
    'div',
    { class: 'solenoid-settings__section' },
    el('div', { class: 'solenoid-settings__section-title' }, 'Appearance'),
    el(
      'div',
      { class: 'solenoid-settings__row solenoid-settings__row--palette' },
      el('span', { class: 'solenoid-settings__row-text' }, el('span', { class: 'solenoid-settings__row-label' }, 'Color palette')),
      el('div', { class: 'solenoid-settings__palette-control' }, el('div', { class: 'solenoid-settings__palette-row' }, wrap, edit), grid.el),
    ),
  );
  const sync = () => {
    select.value = paletteStore.activeBase();
    grid.set(appThemeStore.getAccent());
  };
  const offs = [paletteStore.subscribe(sync), appThemeStore.subscribe(sync)];
  sync();
  return { el: section, destroy: () => [grid.destroy, ...offs].forEach((f) => f()) };
}

let settings = null;

// The Settings dialog: Appearance, then the host's sections ({ title, rows: [Element] }).
export function openSettings({ title = 'Settings', sections = [] } = {}) {
  if (settings) return settings.close;
  const appearance = appearanceSection();
  const close = () => {
    if (!settings) return;
    appearance.destroy();
    settings.m.remove();
    settings = null;
  };
  const m = modal({ label: title, onClose: close });
  const body = el('div', { class: 'solenoid-settings__body' }, appearance.el);
  for (const s of sections) body.append(el('div', { class: 'solenoid-settings__section' }, el('div', { class: 'solenoid-settings__section-title' }, s.title), ...s.rows));
  m.panel.append(m.header(title), body);
  settings = { m, close };
  m.panel.querySelector('select')?.focus();
  return close;
}

// ---------------------------------------------------------------------------------- the Custom editor

let slotRoles = SOLENOID_SLOT_ROLES;
let editor = null;

// Edits preview only in the sample; the app retints once, on Save.
function openEditor() {
  if (editor) return;
  let draft = paletteStore.customMap();
  let chromeDraft = paletteStore.customChrome();
  const close = () => paletteEditorPanel.close();
  const m = modal({ label: 'Custom palette', panelClass: 'sol-pal-panel', onClose: close });
  const slots = el('div', { class: 'sol-pal-editor__slots' });
  const chromeLabel = el('span', { class: 'sol-pal-editor__group-label' });
  const chromeSlots = el('div', { class: 'sol-pal-editor__chrome-slots' });
  const templates = el('div', { class: 'sol-pal-editor__template-btns' });
  const preview = el('div', { class: 'sol-pal-editor__preview' });
  const well = (value, label, onInput) => {
    const input = el('input', { type: 'color', class: 'sol-pal-editor__well', value });
    input.addEventListener('input', () => onInput(input.value));
    return el('label', { class: 'sol-pal-editor__slot' }, input, el('span', { class: 'sol-pal-editor__slot-label' }, label));
  };
  function paintWells() {
    const mode = appThemeStore.getMode();
    slots.replaceChildren(...slotRoles.map(({ slot, label }) => well(draft[slot], label, (hex) => {
      draft = { ...draft, [slot]: hex };
      paintSample();
    })));
    chromeLabel.textContent = `Chrome, ${mode} theme`;
    // The wells edit the live mode's ramp; the other mode's rides through Save untouched.
    chromeSlots.replaceChildren(...CHROME_ROLES.map(({ key, label }) => well(chromeDraft[mode][key] ?? DEFAULT_CHROME[mode][key], label, (hex) => {
      chromeDraft = { ...chromeDraft, [mode]: { ...chromeDraft[mode], [key]: hex } };
      paintSample();
    })));
  }
  for (const name of paletteStore.names()) {
    const b = el('button', { type: 'button', class: 'sol-pal-editor__template-btn' }, name);
    b.addEventListener('click', () => {
      const t = BUILTIN_CHROME[name];
      draft = { ...BUILTIN_PALETTES[name] };
      // A template with no chrome of its own seeds the neutral ramps, as loadCustomTemplate does.
      chromeDraft = { dark: { ...DEFAULT_CHROME.dark, ...t.dark }, light: { ...DEFAULT_CHROME.light, ...t.light } };
      paintWells();
      paintSample();
    });
    templates.append(b);
  }
  function paintSample() {
    const mode = appThemeStore.getMode();
    const gc = themeAccent(draft.gold, mode);
    const accent = themeAccent(draft.blue, mode);
    const note = themeAccent(draft.pink, mode);
    const sample = el('div', { class: 'sol-pal-sample' });
    // The drafted chrome is scoped to the sample, so it shows the draft while the dialog keeps the live theme.
    for (const [k, v] of Object.entries(chromeCssVars(chromeDraft[mode], mode))) sample.style.setProperty(k, v);
    sample.innerHTML = `
      <div class="sol-kit-group" style="--gc:${gc};--gc-dark:${darkenAccent(draft.gold)};--gc-ink:${contrastInk(gc)};--gc-wash:${hexToRgba(gc, mode === 'light' ? 0.12 : 0.14)}">
        <div class="sol-kit-group__head">Group</div>
        <div class="sol-kit-group__body">
          <div class="sol-kit-card" style="--na:${accent};--na-dark:${darkenAccent(draft.blue)}">
            <div class="sol-kit-card__head"><span class="sol-kit-card__title">Math</span><span class="sol-kit-card__hint">Arithmetic</span></div>
            <div class="sol-kit-card__body"><span class="sol-kit-card__value">42</span>
              <svg class="sol-kit-card__socket" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="6" fill="${gc}"/><circle cx="6" cy="6" r="5" fill="none" stroke="var(--socket-ring)" stroke-width="2"/></svg>
            </div>
          </div>
        </div>
      </div>
      <div class="sol-kit-note" style="--nc:${note};--nc-wash:${hexToRgba(note, 0.3)}">
        <div class="sol-kit-note__bar">Note</div>
        <div class="sol-kit-note__body">Lorem ipsum dolor sit amet.</div>
      </div>`;
    preview.replaceChildren(sample);
  }
  const cancel = el('button', { type: 'button', class: 'sol-pal-panel__btn' }, 'Cancel');
  cancel.addEventListener('click', close);
  const save = el('button', { type: 'button', class: 'sol-pal-panel__btn sol-pal-panel__btn--primary' }, 'Save');
  save.addEventListener('click', () => {
    paletteStore.setCustomMap(draft, chromeDraft);
    paletteStore.setActiveBase('Custom');
    close();
  });
  m.panel.append(
    m.header('Custom palette'),
    el(
      'div',
      { class: 'solenoid-settings__body sol-pal-panel__body' },
      slots,
      el('div', { class: 'sol-pal-editor__chrome' }, chromeLabel, chromeSlots),
      el('div', { class: 'sol-pal-editor__templates' }, el('span', { class: 'sol-pal-editor__templates-label' }, 'Load template'), templates),
      preview,
    ),
    el('div', { class: 'sol-pal-panel__footer' }, cancel, save),
  );
  paintWells();
  paintSample();
  const off = appThemeStore.subscribe(() => {
    paintWells();
    paintSample();
  });
  editor = {
    remove() {
      off();
      m.remove();
    },
  };
  m.panel.querySelector('input')?.focus();
}

function closeEditor() {
  editor?.remove();
  editor = null;
}

// ---------------------------------------------------------------------------------------- start-up

// A phone, as Solenoid's coarse.ts decides it: touch-primary, a mobile user agent, held upright. A host may
// pass its own test; the flag is html.is-mobile, which controls.css keys the pill's phone layout on.
export function markDevice(isMobile) {
  const test = isMobile || (() => matchMedia('(pointer: coarse)').matches && /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) && matchMedia('(orientation: portrait)').matches);
  const apply = () => document.documentElement.classList.toggle('is-mobile', !!test());
  addEventListener('resize', apply);
  addEventListener('orientationchange', apply);
  apply();
}

// Every slot as a CSS variable, light-mode drop applied, with its ink: --slot-gold, --slot-gold-ink. Solenoid
// reads slots through nodeAccent in script; a page that colors its own things by slot reads these instead.
export function slotVars(mode = appThemeStore.getMode()) {
  const out = {};
  for (const slot of Object.keys(PALETTE)) {
    const hex = themeAccent(resolveColor(slot), mode);
    out[`--slot-${slot}`] = hex;
    out[`--slot-${slot}-ink`] = contrastInk(hex);
  }
  return out;
}

function applySlotVars() {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(slotVars())) root.style.setProperty(k, v);
}

let started = false;

// Once, at start-up: the persisted palette and theme, the slot variables, the phone flag, and the Custom editor
// wired to Edit custom…. `slotRoles` names the slots in that editor ({ slot, label } in the order shown).
export function initTheme({ slotRoles: roles, isMobile } = {}) {
  if (roles) slotRoles = roles;
  if (started) return;
  started = true;
  initAppTheme();
  applySlotVars();
  appThemeStore.subscribe(applySlotVars);
  markDevice(isMobile);
  paletteEditorPanel.subscribe(() => (paletteEditorPanel.get() ? openEditor() : closeEditor()));
}
