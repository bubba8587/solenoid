// Dev-only copy-edit freeze: Ctrl+Alt+E blocks the app, and a click edits a string's source form through Vite's
// `/__copy-edit` (vite.config.ts). Enter or clickaway saves every place it appears; Escape reverts, Escape idle exits.
// Listeners register once at module load (app boot), so their capture handlers run ahead of every later listener.

// `html` is the original rendered markup: restoring textContent instead would flatten markdown marks, and a
// re-render that sees the same __html would not repaint it.
type Editing = { el: HTMLElement; rendered: string; raw: string; html: string };

let active = false;
let editing: Editing | null = null;
let overlay: HTMLDivElement | null = null;
let badge: HTMLDivElement | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let lookupToken = 0;

const IDLE_HINT = "Copy edit · click a string · Enter commits · Esc exits";

const STYLE_CSS = `
.sol-copyedit-overlay {
  position: fixed; inset: 0; pointer-events: none; z-index: 99998;
  border: 2px dashed var(--accent, #f5b914); opacity: 0.55;
}
.sol-copyedit-badge {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  z-index: 99999; pointer-events: none;
  padding: 5px 12px; border-radius: 999px;
  background: var(--surface, #1e1e1e); color: var(--text, #e8e8e8);
  border: 1px solid var(--border-strong, #3a3a3a);
  font: 500 11px/1.4 var(--font-mono, ui-monospace, monospace);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  white-space: nowrap; max-width: 90vw; overflow: hidden; text-overflow: ellipsis;
}
.sol-copyedit-editing {
  outline: 1px solid var(--accent, #f5b914) !important;
  outline-offset: 1px;
  cursor: text;
}
`;

function flash(msg: string): void {
  if (!badge) return;
  badge.textContent = msg;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (badge) badge.textContent = IDLE_HINT; }, 4000);
}

function textTarget(start: EventTarget | null): HTMLElement | null {
  let n = start instanceof HTMLElement ? start : null;
  while (n && getComputedStyle(n).display === "inline") n = n.parentElement;
  for (let hops = 0; n && hops < 2; hops++, n = n.parentElement) {
    if (n.classList.contains("sol-copyedit-badge")) return null;
    const text = n.textContent ?? "";
    if (text.trim() && text.length < 600) return n;
  }
  return null;
}

async function api(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch("/__copy-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await r.json()) as Record<string, unknown>;
}

const placeLabel = (count: number, files: string[]) =>
  `${files[0]!.replace(/^src\//, "")}${count > 1 ? ` · ${count} places` : ""}`;

function beginEdit(el: HTMLElement): void {
  const rendered = el.textContent ?? "";
  const html = el.innerHTML;
  const token = ++lookupToken;
  flash("Looking up…");
  void api({ action: "lookup", text: rendered })
    .then((d) => {
      if (token !== lookupToken || !active) return;
      if (d.status !== "found") { flash("Not in source (dynamic or document text)"); return; }
      editing = { el, rendered, raw: String(d.raw), html };
      el.textContent = String(d.raw); // edit the SOURCE form, markdown marks included
      el.setAttribute("contenteditable", "plaintext-only");
      el.classList.add("sol-copyedit-editing");
      el.focus();
      // Holds app polls while editing: a re-render could repaint rendered markup over the raw text and save it flattened.
      document.documentElement.classList.add("sol-copyediting");
      flash(`Editing ${placeLabel(Number(d.count), d.files as string[])}`);
    })
    .catch(() => flash("Copy-edit endpoint unreachable"));
}

function endEdit(revert: boolean): void {
  lookupToken++;
  if (!editing) return;
  document.documentElement.classList.remove("sol-copyediting"); // polls resume; save-driven HMR repaints
  const { el, rendered, raw, html } = editing;
  editing = null;
  el.removeAttribute("contenteditable");
  el.classList.remove("sol-copyedit-editing");
  const after = el.textContent ?? "";
  el.innerHTML = html;
  if (revert || after === raw) return; // untouched: no rewrite, no log line
  flash("Saving…");
  void api({ text: rendered, after })
    .then((d) => {
      if (d.status === "saved") flash(`Saved → ${placeLabel(Number(d.count), d.files as string[])}`);
      else if (d.status === "notfound") flash("Source changed underneath; not written");
      else flash(`Failed: ${String(d.message)}`);
    })
    .catch(() => flash("Copy-edit endpoint unreachable"));
}

// ── event interception (registered at boot, gated on `active`) ─────────────────

function insideEdit(e: Event): boolean {
  return !!(editing && e.target instanceof Node && editing.el.contains(e.target));
}

function onPointerDown(e: Event): void {
  if (!active) return;
  e.stopImmediatePropagation();
  if (insideEdit(e)) return; // native caret placement inside the open edit
  e.preventDefault();
  endEdit(false);
  const el = textTarget(e.target);
  if (el) beginEdit(el);
}

function onBlockedPointer(e: Event): void {
  if (!active) return;
  e.stopImmediatePropagation();
  if (!insideEdit(e)) e.preventDefault();
}

function onWheel(e: Event): void {
  if (!active) return;
  e.stopImmediatePropagation(); // panels still scroll natively; app zoom handlers don't see it
}

function onKeyDown(e: KeyboardEvent): void {
  if (isHotkey(e)) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); return; }
  if (!active) return;
  e.stopImmediatePropagation();
  if (e.key === "Escape") {
    e.preventDefault();
    if (editing) endEdit(true);
    else toggle();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && editing) { e.preventDefault(); endEdit(false); }
}

function onKeyPassthrough(e: KeyboardEvent): void {
  if (active) e.stopImmediatePropagation();
}

function onBlurCapture(e: FocusEvent): void {
  if (active && editing && e.target === editing.el) endEdit(false);
}

function toggle(): void {
  active = !active;
  if (active) {
    overlay = document.createElement("div");
    overlay.className = "sol-copyedit-overlay";
    badge = document.createElement("div");
    badge.className = "sol-copyedit-badge";
    badge.textContent = IDLE_HINT;
    document.body.append(overlay, badge);
  } else {
    endEdit(false);
    overlay?.remove(); overlay = null;
    badge?.remove(); badge = null;
  }
}

function isHotkey(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.altKey && !e.shiftKey && (e.key === "e" || e.key === "E");
}

const style = document.createElement("style");
style.textContent = STYLE_CSS;
document.head.appendChild(style);

const OPTS = { capture: true, passive: false } as const;
window.addEventListener("pointerdown", onPointerDown, OPTS);
for (const type of ["mousedown", "pointerup", "mouseup", "click", "dblclick", "contextmenu", "touchstart"]) {
  window.addEventListener(type, onBlockedPointer, OPTS);
}
window.addEventListener("wheel", onWheel, OPTS);
window.addEventListener("keydown", onKeyDown, OPTS);
window.addEventListener("keyup", onKeyPassthrough, OPTS);
window.addEventListener("keypress", onKeyPassthrough, OPTS);
window.addEventListener("blur", onBlurCapture, true);

export {};
