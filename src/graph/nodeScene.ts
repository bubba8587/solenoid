import { createNotifier } from "./storeKit";
import { getArea, getEditor } from "./process";
import { nodeKindOf } from "./nodes/kind";
import { NODE_KIND_ACCENTS } from "./nodes/shared";
import { parseColor, type RGBA } from "./cssColor";
import type { NodeCard } from "./nodeInstances";

// Live node rectangles + kind colors for the WebGPU node-card renderer. Canvas bumps
// `nodeGeomBus` only on move/resize/add/remove — pan/zoom just re-draws.

export const nodeGeomBus = createNotifier();

const DEFAULT_RADIUS = 8;
const DEFAULT_HEADER_H = 26;
const FALLBACK_BODY: RGBA = { r: 30, g: 33, b: 40, a: 1 };

// Read from a real element's computed background so no theme var name is hard-coded.
function readBodyColor(sampleEl: HTMLElement | null): RGBA {
  if (!sampleEl) return FALLBACK_BODY;
  try {
    const bg = getComputedStyle(sampleEl).backgroundColor;
    return parseColor(bg) ?? FALLBACK_BODY;
  } catch { return FALLBACK_BODY; }
}

/** Regular `.solenoid-node` roots only; [] if editor/area aren't ready. Header height
 *  is measured per node — titles wrap, so a fixed height under-covers a 2-line header. */
export function collectNodeCards(radius = DEFAULT_RADIUS): NodeCard[] {
  const area = getArea();
  const editor = getEditor();
  if (!area || !editor) return [];
  const cards: NodeCard[] = [];
  let body: RGBA | null = null;
  for (const node of editor.getNodes()) {
    const view = area.nodeViews.get(node.id);
    const el = view?.element;
    if (!view || !el) continue;
    const card = el.querySelector<HTMLElement>(".solenoid-node") ?? (el.classList.contains("solenoid-node") ? el : null);
    if (!card) continue;
    if (!body) body = readBodyColor(card);
    const w = card.offsetWidth, h = card.offsetHeight;
    if (w <= 0 || h <= 0) continue;
    const headerEl = card.querySelector<HTMLElement>(".solenoid-node__header");
    const headerH = headerEl && headerEl.offsetHeight > 0 ? headerEl.offsetHeight : DEFAULT_HEADER_H;
    const header = parseColor(NODE_KIND_ACCENTS[nodeKindOf(node)]) ?? { r: 120, g: 130, b: 150, a: 1 };
    cards.push({ x: view.position.x, y: view.position.y, w, h, body: body ?? FALLBACK_BODY, header, radius, headerH });
  }
  return cards;
}
