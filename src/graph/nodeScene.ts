import { createNotifier } from "./storeKit";
import { getArea, getEditor } from "./process";
import { nodeKindOf } from "./nodes/kind";
import { NODE_KIND_ACCENTS } from "./nodes/shared";
import { parseColor, type RGBA } from "./cssColor";
import type { NodeCard } from "./nodeInstances";

// Node scene — reads the LIVE node rectangles + kind colors from rete's area, for
// the WebGPU node-card renderer (the LOD stand-in for the DOM node bodies). Kept
// separate from the renderer so the geometry read is testable-by-eye and the GPU
// plumbing stays thin. nodeGeomBus is bumped by Canvas when nodes move/resize/add/
// remove, so the card layer rebuilds only then (pan/zoom just re-draws — node world
// rects don't change on pan).

/** Bumped (by Canvas's area pipe) whenever node geometry changes. */
export const nodeGeomBus = createNotifier();

const DEFAULT_RADIUS = 8;
const DEFAULT_HEADER_H = 26;
const FALLBACK_BODY: RGBA = { r: 30, g: 33, b: 40, a: 1 };

// The card body fill, read once from a real node element's computed background so we
// don't hard-code a theme var name. Re-read each collect (cheap; covers theme flips).
function readBodyColor(sampleEl: HTMLElement | null): RGBA {
  if (!sampleEl) return FALLBACK_BODY;
  try {
    const bg = getComputedStyle(sampleEl).backgroundColor; // "rgb(r, g, b)" / "rgba(...)"
    return parseColor(bg) ?? FALLBACK_BODY;
  } catch { return FALLBACK_BODY; }
}

/** Collect the current node cards (regular `.solenoid-node` roots only — groups /
 *  notes / conduits have distinct visuals and are skipped for now). World rect from
 *  the area node view's position + the element's unscaled offset box; header color
 *  from the node kind; header HEIGHT measured per node (titles wrap to 1–2 lines, so
 *  a fixed height under-covers a 2-line header). Returns [] if editor/area aren't ready. */
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
    // Only regular node cards (skip group/note/conduit roots).
    const card = el.querySelector<HTMLElement>(".solenoid-node") ?? (el.classList.contains("solenoid-node") ? el : null);
    if (!card) continue;
    if (!body) body = readBodyColor(card);
    const w = card.offsetWidth, h = card.offsetHeight;
    if (w <= 0 || h <= 0) continue;
    // Measure the real header so the GPU header bar matches a 1- vs 2-line title.
    const headerEl = card.querySelector<HTMLElement>(".solenoid-node__header");
    const headerH = headerEl && headerEl.offsetHeight > 0 ? headerEl.offsetHeight : DEFAULT_HEADER_H;
    const header = parseColor(NODE_KIND_ACCENTS[nodeKindOf(node)]) ?? { r: 120, g: 130, b: 150, a: 1 };
    cards.push({ x: view.position.x, y: view.position.y, w, h, body: body ?? FALLBACK_BODY, header, radius, headerH });
  }
  return cards;
}
