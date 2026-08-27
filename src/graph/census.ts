// Console-only tooling for the backlog "Per-card CSS conversion" sweep, STEP 1 (the
// census probe). For every catalog node type it mounts one card on the live editor,
// walks the card's DOM, and classifies each element as either carrying a value / a
// handler (a form control, a socket, or text) or being PAINT-ONLY (a purely decorative
// div / svg that step 2 could move to a pseudo-element / background / mask). It removes
// each card after measuring, so the canvas is left as it was found.
//
// Runs on the REAL dev page so the app's own component tree + CSS classes are what get
// counted. Driven by scripts/card-css-census.mjs; results land in docs/dev-notes.md.
// Charts/popups mount recharts lazily, so their figure interior is under-counted — the
// census targets card CHROME (sockets, dividers, badges, chips, rings), which is the
// step-2 conversion surface, not the plotted figure.
import { FLAT_CATALOG } from "./catalogUtils";
import { getEditor, getArea } from "./process";

const frames = (n: number) =>
  new Promise<void>((r) => {
    const step = (left: number) => (left <= 0 ? r() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

export interface CardCensusRow {
  type: string;
  root: string;          // the card root's tag.class (roots vary — see CLAUDE.md)
  total: number;         // every element in the card subtree
  valueOrHandler: number;
  paintOnly: number;
  /** Paint-only elements by `tag.firstClass`, the step-2 conversion candidates. */
  paintClasses: Record<string, number>;
}

// An element CARRIES SOMETHING (a value or a handler) when it is a form control, a
// socket (a connection endpoint), editable, or shows text. Everything else on the card
// is paint: structure and decoration.
function carries(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button" || tag === "a" || tag === "img") return true;
  if (el.hasAttribute("contenteditable")) return true;
  if (el.hasAttribute("data-socket-side")) return true;
  // A DIRECT non-whitespace text node = a label / value / glyph character.
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "") return true;
  }
  return false;
}

function tagClass(el: Element): string {
  const first = el.classList[0];
  return first ? `${el.tagName.toLowerCase()}.${first}` : el.tagName.toLowerCase();
}

async function censusOne(type: string, create: () => object): Promise<CardCensusRow | null> {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) throw new Error("editor/area not ready");
  let node: { id: string } | null = null;
  try {
    node = create() as { id: string };
    await editor.addNode(node as never);
    await frames(2);
    const view = area.nodeViews.get(node.id);
    const el = view?.element as HTMLElement | undefined;
    if (!el) return null;
    // The card root sits under rete's view wrapper; take the first element child.
    const card = (el.firstElementChild as HTMLElement | null) ?? el;
    const all = card.querySelectorAll("*");
    let valueOrHandler = 0;
    const paintClasses: Record<string, number> = {};
    for (const child of all) {
      if (carries(child)) valueOrHandler++;
      else { const k = tagClass(child); paintClasses[k] = (paintClasses[k] ?? 0) + 1; }
    }
    const total = all.length;
    return { type, root: tagClass(card), total, valueOrHandler, paintOnly: total - valueOrHandler, paintClasses };
  } catch {
    return null; // a node that needs special context (composite drill-in, etc.) is skipped
  } finally {
    if (node) { try { await editor.removeNode(node.id); } catch { /* already gone */ } }
  }
}

/** Mount → measure → remove every catalog node type, one at a time. Returns the rows
 *  plus an aggregate paint-class histogram across all card types. */
async function census(): Promise<{ rows: CardCensusRow[]; paintTotals: Record<string, number> }> {
  const rows: CardCensusRow[] = [];
  for (const [type, entry] of FLAT_CATALOG) {
    const create = (entry as { create?: () => object }).create;
    if (typeof create !== "function") continue;
    const row = await censusOne(type, create);
    if (row) rows.push(row);
  }
  const paintTotals: Record<string, number> = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.paintClasses)) paintTotals[k] = (paintTotals[k] ?? 0) + n;
  return { rows, paintTotals };
}

declare global {
  interface Window {
    __solenoidCardCensus?: () => Promise<{ rows: CardCensusRow[]; paintTotals: Record<string, number> }>;
  }
}
window.__solenoidCardCensus = census;
