// Dev-only copy-edit FREEZE (loaded from main.tsx in DEV builds only). Ctrl+Alt+E
// freezes the app: every app handler is blocked in window capture, and a click on any
// on-screen string looks it up through the Vite `/__copy-edit` endpoint
// (vite.config.ts — the string-editor's mapper, markdown-aware) and turns the element
// contenteditable IN ITS SOURCE FORM, backticks and all. Enter or clickaway commits;
// the save rewrites EVERY source place the string appears, and HMR repaints. Escape
// reverts an edit; Escape idle (or Ctrl+Alt+E) exits the freeze.
//
// The listeners are registered ONCE at module load and gated on `active`: module load
// happens at app boot, BEFORE any overlay mounts, so these capture handlers run ahead
// of every later listener (the Reference overlay's own capture-phase Escape included).

type Editing = { el: HTMLElement; rendered: string; raw: string };

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

/** The nearest BLOCK-level element rendering the clicked string: an inline fragment
 *  (a markdown <code>/<strong>, a highlight span) climbs to the paragraph, cell or
 *  label that carries the whole source string. */
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

/** Resolve the clicked element's string to its source form, then start the edit. */
function beginEdit(el: HTMLElement): void {
  const rendered = el.textContent ?? "";
  const token = ++lookupToken;
  flash("Looking up…");
  void api({ action: "lookup", text: rendered })
    .then((d) => {
      if (token !== lookupToken || !active) return;
      if (d.status !== "found") { flash("Not in source (dynamic or document text)"); return; }
      editing = { el, rendered, raw: String(d.raw) };
      el.textContent = String(d.raw); // edit the SOURCE form, markdown marks included
      el.setAttribute("contenteditable", "plaintext-only");
      el.classList.add("sol-copyedit-editing");
      el.focus();
      flash(`Editing ${placeLabel(Number(d.count), d.files as string[])}`);
    })
    .catch(() => flash("Copy-edit endpoint unreachable"));
}

function endEdit(revert: boolean): void {
  lookupToken++;
  if (!editing) return;
  const { el, rendered, raw } = editing;
  editing = null;
  el.removeAttribute("contenteditable");
  el.classList.remove("sol-copyedit-editing");
  const after = el.textContent ?? "";
  el.textContent = rendered; // HMR re-renders the real thing after a save
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
