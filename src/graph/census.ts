// Console-only census probe (driven by scripts/card-css-census.mjs): mounts one card per catalog type on the live editor,
// classifies each element as carrying a value or handler, or paint-only, and removes the card again.
// Charts mount recharts lazily, so a figure interior is under-counted; the census targets card chrome.
import { FLAT_CATALOG } from "./catalogUtils";
import { getEditor, getView } from "./process";
const frames = (n: number) =>
  new Promise<void>((r) => {
    const step = (left: number) => (left <= 0 ? r() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

export interface CardCensusRow {
  type: string;
  root: string;          // the card root's tag.class
  total: number;         // every element in the card subtree
  valueOrHandler: number;
  paintOnly: number;
  /** Paint-only elements by `tag.firstClass`, the step-2 conversion candidates. */
  paintClasses: Record<string, number>;
}

// Carries something: a form control, a socket, an editable element, or one showing text; everything else is paint.
function carries(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || tag === "button" || tag === "a" || tag === "img") return true;
  if (el.hasAttribute("contenteditable")) return true;
  // A Conduit's lane square IS its socket, without NodeSocket's wrapper attributes.
  if (el.hasAttribute("data-socket-side") || el.classList.contains("solenoid-conduit__lane")) return true;
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
  const view = getView();
  if (!editor || !view) throw new Error("editor/view not ready");
  let node: { id: string } | null = null;
  try {
    node = create() as { id: string };
    await editor.addNode(node as never);
    await frames(2);
    const el = view.nodeElement(node.id);
    if (!el) return null;
    // The card root sits under the RF node wrapper; take the first element child.
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
