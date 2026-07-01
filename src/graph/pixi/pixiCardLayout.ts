// Pure layout math for a Pixi node card — where the header bar, title, value
// text, and socket dots sit relative to the card origin (top-left, world units).
// No Pixi dependency, so it's unit-testable; mirrors the DOM card's feel
// (180px wide, ~26px header, 9px gutter) without importing the CSS.

export const CARD = {
  defaultWidth: 180,
  headerH: 26,
  bodyPad: 9,
  titleTop: 6,
  valueTopInBody: 12, // from the body top (below the header)
  socketRadius: 6,
  radius: 8,
} as const;

export interface Rect { x: number; y: number; w: number; h: number }

export interface CardParts {
  radius: number;
  header: Rect;
  body: Rect;
  title: { x: number; y: number }; // text top-left anchor
  value: { x: number; y: number };
}

/** Sub-rects + text anchors for a card of size w×h with a header of headerH. */
export function cardParts(w: number, h: number, headerH: number = CARD.headerH): CardParts {
  return {
    radius: CARD.radius,
    header: { x: 0, y: 0, w, h: headerH },
    body: { x: 0, y: headerH, w, h: Math.max(0, h - headerH) },
    title: { x: CARD.bodyPad, y: CARD.titleTop },
    value: { x: CARD.bodyPad, y: headerH + CARD.valueTopInBody },
  };
}

/** Evenly-distribute `count` socket-dot Y centers across [top, bottom]. One
 *  socket centers; N sockets are spaced with equal gaps. Used by the SYNTHETIC
 *  cards (live cards scrape real socket positions from the DOM instead). */
export function distributeSockets(count: number, top: number, bottom: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(top + bottom) / 2];
  const span = bottom - top;
  const step = span / (count + 1);
  const ys: number[] = [];
  for (let i = 1; i <= count; i++) ys.push(top + step * i);
  return ys;
}

/** Greedy word-wrap into lines of at most `maxChars` (long words hard-split). */
export function wrapText(text: string, maxChars: number): string[] {
  if (maxChars < 1 || text.length <= maxChars) return [text];
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    if (cur && cur.length + 1 + word.length > maxChars) { lines.push(cur); cur = ""; }
    cur = cur ? cur + " " + word : word;
    while (cur.length > maxChars) { lines.push(cur.slice(0, maxChars)); cur = cur.slice(maxChars); }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

/** Does a card rect overlap a world-space view box? (frustum cull test) */
export function rectIntersects(
  card: { x: number; y: number; w: number; h: number },
  view: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return card.x < view.maxX && card.x + card.w > view.minX && card.y < view.maxY && card.y + card.h > view.minY;
}

/** Axis-aligned bounding box over card rects (world units). Returns a zero-area
 *  box centered at origin for an empty list (so Camera.fit degrades cleanly). */
export function cardsBounds(cards: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  if (cards.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
  }
  return { minX, minY, maxX, maxY };
}
