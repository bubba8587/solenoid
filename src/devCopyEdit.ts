// Dev-only copy-edit FREEZE (loaded from main.tsx in DEV builds only). Ctrl+Alt+E
// freezes the app: every app handler is blocked in window capture, and a click on any
// on-screen string turns it contenteditable in place. Enter or clickaway commits the
// edit to the Vite `/__copy-edit` endpoint (vite.config.ts), which maps the BEFORE
// text to its unique source literal via the string-editor's mapper and rewrites it —
// HMR then repaints the app with the new string. Escape reverts an edit; Escape idle
// (or Ctrl+Alt+E) exits the freeze. Ambiguous or unmatched strings are reported on
// the badge and the source is left alone; attribute strings (tooltips, placeholders)
// are out of reach — this edits rendered text nodes.

type Editing = { el: HTMLElement; before: string };

let active = false;
let editing: Editing | null = null;
let overlay: HTMLDivElement | null = null;
let badge: HTMLDivElement | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

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
  white-space: nowrap;
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
  flashTimer = setTimeout(() => { if (badge) badge.textContent = IDLE_HINT; }, 3500);
}

/** The nearest element (a few hops up) that renders its own text. */
function textTarget(start: EventTarget | null): HTMLElement | null {
  let n = start instanceof HTMLElement ? start : null;
  for (let hops = 0; n && hops < 3; hops++, n = n.parentElement) {
    if (n.classList.contains("sol-copyedit-badge")) return null;
    const own = [...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim());
    if (own && (n.textContent ?? "").length < 500) return n;
  }
  return null;
}

function startEdit(el: HTMLElement): void {
  editing = { el, before: el.textContent ?? "" };
  el.setAttribute("contenteditable", "plaintext-only");
  el.classList.add("sol-copyedit-editing");
  el.focus();
}

function endEdit(revert: boolean): void {
  if (!editing) return;
  const { el, before } = editing;
  editing = null;
  el.removeAttribute("contenteditable");
  el.classList.remove("sol-copyedit-editing");
  const after = el.textContent ?? "";
  if (revert || after === before) { el.textContent = before; return; }
  flash("Saving…");
  void fetch("/__copy-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ before, after }),
  })
    .then((r) => r.json())
    .then((d: { status: string; file?: string; count?: number; message?: string }) => {
      if (d.status === "saved") { flash(`Saved → ${d.file}`); return; }
      el.textContent = before; // the source did not change; put the screen back
      flash(
        d.status === "ambiguous" ? `${d.count} source matches — not written` :
        d.status === "notfound" ? "Not a source literal (dynamic or document text)" :
        `Failed: ${d.message}`,
      );
    })
    .catch(() => { el.textContent = before; flash("Copy-edit endpoint unreachable"); });
}

// ── event interception (window capture runs before every app listener) ──────────

function onPointerDown(e: Event): void {
  e.stopImmediatePropagation();
  if (editing && e.target instanceof Node && editing.el.contains(e.target)) return; // native caret placement
  e.preventDefault();
  endEdit(false);
  const el = textTarget(e.target);
  if (el) startEdit(el);
}

function onBlockedPointer(e: Event): void {
  e.stopImmediatePropagation();
  if (!(editing && e.target instanceof Node && editing.el.contains(e.target))) e.preventDefault();
}

function onWheel(e: Event): void {
  e.stopImmediatePropagation(); // panels still scroll natively; app zoom handlers don't see it
}

function onKeyDown(e: KeyboardEvent): void {
  if (isHotkey(e)) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); return; }
  e.stopImmediatePropagation();
  if (e.key === "Escape") {
    e.preventDefault();
    if (editing) endEdit(true);
    else toggle();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && editing) { e.preventDefault(); endEdit(false); }
}

function onKeyUp(e: KeyboardEvent): void {
  e.stopImmediatePropagation();
}

function onBlurCapture(e: FocusEvent): void {
  if (editing && e.target === editing.el) endEdit(false);
}

const BLOCKED: Array<[string, (e: Event) => void]> = [
  ["pointerdown", onPointerDown],
  ["mousedown", onBlockedPointer],
  ["pointerup", onBlockedPointer],
  ["mouseup", onBlockedPointer],
  ["click", onBlockedPointer],
  ["dblclick", onBlockedPointer],
  ["contextmenu", onBlockedPointer],
  ["touchstart", onBlockedPointer],
  ["wheel", onWheel],
  ["keydown", onKeyDown as (e: Event) => void],
  ["keyup", onKeyUp as (e: Event) => void],
  ["keypress", onKeyUp as (e: Event) => void],
];

function toggle(): void {
  active = !active;
  if (active) {
    for (const [type, fn] of BLOCKED) window.addEventListener(type, fn, { capture: true, passive: false });
    window.addEventListener("blur", onBlurCapture as (e: Event) => void, true);
    overlay = document.createElement("div");
    overlay.className = "sol-copyedit-overlay";
    badge = document.createElement("div");
    badge.className = "sol-copyedit-badge";
    badge.textContent = IDLE_HINT;
    document.body.append(overlay, badge);
  } else {
    endEdit(false);
    for (const [type, fn] of BLOCKED) window.removeEventListener(type, fn, true);
    window.removeEventListener("blur", onBlurCapture as (e: Event) => void, true);
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

window.addEventListener(
  "keydown",
  (e) => { if (!active && isHotkey(e)) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); } },
  true,
);

export {};
