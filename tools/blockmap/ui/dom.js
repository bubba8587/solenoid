// Small DOM helpers and the icon set. Browser only.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function setText(el, text) {
  const t = String(text ?? '');
  if (el.textContent !== t) el.textContent = t;
}

export function setHtml(el, html) {
  if (el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}

export function toggle(el, cls, on) {
  if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 1)).toUpperCase();
}

const P = {
  bug: '<path d="M8 4.2c1.6 0 2.8 1.2 2.8 2.9v3.1c0 1.7-1.3 3.1-2.8 3.1s-2.8-1.4-2.8-3.1V7.1C5.2 5.4 6.4 4.2 8 4.2Z"/><path d="M6.3 4.6 5.2 3M9.7 4.6 10.8 3M5.2 8H3M5.2 11H3.4M10.8 8H13M10.8 11h1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  task: '<rect x="3.2" y="3.2" width="9.6" height="9.6" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  done: '<rect x="3.2" y="3.2" width="9.6" height="9.6" rx="2"/><path d="m5.6 8.2 1.7 1.7 3.2-3.6" fill="none" stroke="var(--raised)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  decision: '<path d="M8 2.6 13.4 8 8 13.4 2.6 8Z"/>',
  question: '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.4 6.4c.1-.9.8-1.5 1.7-1.5.9 0 1.6.6 1.6 1.4 0 1.3-1.6 1.3-1.6 2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8.1" cy="11" r=".85"/>',
  check: '<path d="m3.5 8.4 2.9 2.9 6-6.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<path d="m4.3 4.3 7.4 7.4m0-7.4-7.4 7.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  lock: '<rect x="3.6" y="7.2" width="8.8" height="6.2" rx="1.6"/><path d="M5.6 7.2V5.6a2.4 2.4 0 0 1 4.8 0v1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  eye: '<path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4-6.2-4-6.2-4Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.9"/>',
  flame: '<path d="M8 1.8c.4 2.2 3.8 3.6 3.8 7.2a3.8 3.8 0 0 1-7.6 0c0-1.6.8-2.6 1.6-3.3.1 1.2.7 1.9 1.4 2.1C7 5.9 7.4 3.6 8 1.8Z"/>',
  send: '<path d="M2.6 8 13.4 3 10.6 13 8 9.2Z"/>',
  play: '<path d="M4.6 3.2v9.6L12.8 8Z"/>',
  pause: '<rect x="4" y="3.4" width="2.8" height="9.2" rx=".8"/><rect x="9.2" y="3.4" width="2.8" height="9.2" rx=".8"/>',
  search: '<circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.2 10.2 3.4 3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  moon: '<path d="M12.8 10.2A5.6 5.6 0 0 1 5.8 3.2a5.6 5.6 0 1 0 7 7Z"/>',
  close: '<path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  hand: '<path d="M5.4 8.6V4.2a.9.9 0 0 1 1.8 0v3.4-4.6a.9.9 0 0 1 1.8 0v4.6-3.8a.9.9 0 0 1 1.8 0v4.2-2.6a.9.9 0 0 1 1.8 0v3.8c0 2.6-1.8 4.4-4.3 4.4-1.6 0-2.6-.7-3.5-1.9L3.3 9.2a.9.9 0 0 1 1.4-1.1Z"/>',
  queue: '<path d="M3 4.5h10M3 8h10M3 11.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  live: '<circle cx="8" cy="8" r="3.4"/>',
  run: '<path d="M3 4.6 6.4 8 3 11.4M7.8 11.6h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  edit: '<path d="M3 13l.8-3.2 6.6-6.6 2.4 2.4-6.6 6.6Z"/>',
  file: '<path d="M4.2 2.4h5l2.6 2.6v8.6H4.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  note: '<path d="M3 3.4h10v7H8.4L5.4 13v-2.6H3Z"/>',
  reserve: '<path d="M8 2.4 13 5v6L8 13.6 3 11V5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 13.6V8m0 0 5-3M8 8 3 5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  release: '<path d="M8 13V5.4m0 0L5 8.4m3-3 3 3M3.6 3h8.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  join: '<circle cx="8" cy="5.6" r="2.6"/><path d="M3 13.4c.6-2.6 2.6-4 5-4s4.4 1.4 5 4Z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function toast(text, kind = 'info') {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}` }, text);
  host.append(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 5200 : 2600);
  setTimeout(() => t.remove(), kind === 'error' ? 5600 : 3000);
}

export function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience; the page works without it.
  }
}
