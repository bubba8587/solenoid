// Shelf packer for the HTML-in-Canvas paint-raster ATLAS. The pyramid-build fallback
// (htmlCanvasRenderer.rasterPendingInPaint) used to snapshot each node's raster with its
// own createImageBitmap(canvas, region) — a GPU read-back PER NODE, ~16 per paint, which
// is the expensive pattern on mobile GPUs. Packing the batch into one atlas region lets
// the whole paint be snapshotted with ONE canvas read-back; per-node textures then come
// from bitmap→bitmap crops (createImageBitmap(atlas, x, y, w, h) — no canvas read-back).
//
// Pure geometry (no DOM) so the packing is unit-testable: rasterAtlas.test.ts.

export interface AtlasItem {
  id: string;
  /** Natural (padded) capture size in raster px. */
  w: number;
  h: number;
}

export interface AtlasPlacement {
  id: string;
  /** Atlas position + drawn size in raster px (post-scale, ≥1). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn px ÷ natural px (≤1; <1 only when the item alone outsizes the atlas). */
  scale: number;
}

export interface AtlasLayout {
  placements: AtlasPlacement[];
  /** Ids that did not fit this round — raster them in a later paint. */
  unplaced: string[];
  /** Tight bounding region actually used (snapshot just this much). */
  usedW: number;
  usedH: number;
}

/** Gutter between placements so a crop never bleeds a neighbor's edge pixels
 *  (drawElementImage anti-aliases the card edge into adjacent px). */
export const ATLAS_GUTTER = 2;

/**
 * Shelf-pack `items` into a maxW×maxH region. Items are placed tallest-first
 * (classic shelf heuristic — keeps shelves dense); an item larger than the whole
 * atlas is scaled down to fit alone (its `scale` rides into the mip pyramid, as
 * the old per-node path did). Items that don't fit the remaining space are
 * returned in `unplaced` for the next round, in their tallest-first order.
 */
export function packAtlas(items: AtlasItem[], maxW: number, maxH: number): AtlasLayout {
  const placements: AtlasPlacement[] = [];
  const unplaced: string[] = [];
  if (maxW < 1 || maxH < 1) return { placements, unplaced: items.map((i) => i.id), usedW: 0, usedH: 0 };

  // Tallest-first (scaled height). Sort a copy — callers keep their order.
  const sized = items.map((it) => {
    const scale = Math.min(1, maxW / Math.max(1, it.w), maxH / Math.max(1, it.h));
    return { it, scale, w: Math.max(1, Math.round(it.w * scale)), h: Math.max(1, Math.round(it.h * scale)) };
  });
  sized.sort((a, b) => b.h - a.h);

  let x = 0, y = 0, shelfH = 0, usedW = 0, usedH = 0;
  for (const s of sized) {
    if (x > 0 && x + s.w > maxW) { // wrap to a new shelf
      y += shelfH + ATLAS_GUTTER;
      x = 0;
      shelfH = 0;
    }
    if (y + s.h > maxH) { unplaced.push(s.it.id); continue; } // out of atlas — next round
    placements.push({ id: s.it.id, x, y, w: s.w, h: s.h, scale: s.scale });
    x += s.w + ATLAS_GUTTER;
    shelfH = Math.max(shelfH, s.h);
    usedW = Math.max(usedW, x - ATLAS_GUTTER);
    usedH = Math.max(usedH, y + s.h);
  }
  return { placements, unplaced, usedW, usedH };
}
