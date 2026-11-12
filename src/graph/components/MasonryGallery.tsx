// [[chart-figures#The Record figure]]
// The masonry the Record figure's Gallery and Cards and Describe's Profile pack tiles into, the Pinterest pack of
// `masonryLayout.ts`: measured tile heights, absolute placements, tracks floored to whole pixels.
import { useLayoutEffect, useRef, useState } from "react";
import { planColumns, packMasonry } from "./masonryLayout";

const GALLERY_GAP = 6;

export type Track = { ideal: number; min: number; max: number };

/** The masonry the galleries and Describe's Profile pack into; `layoutKey` changes when the tiles do, so they are
 *  re-measured. A tile is handed its track's width, for a chart that draws to a width. */
export function MasonryGallery({ count, track, className, layoutKey, tile, gap = GALLERY_GAP }: {
  count: number;
  track: Track;
  className: string;
  layoutKey: unknown;
  tile: (i: number, width: number) => React.ReactNode;
  gap?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shownOnce = useRef(false);
  const n = count;
  const [box, setBox] = useState<{ w: number; heights: number[]; settled: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const tiles = tileRefs.current.slice(0, n);
      const heights = tiles.map((t) => (t ? t.offsetHeight : 0));
      const want = Math.floor(planColumns(w, gap, { ...track, items: n }).colWidth);
      const settled = tiles.every((t) => !t || t.offsetWidth === want);
      setBox((prev) =>
        prev && prev.w === w && prev.settled === settled &&
        prev.heights.length === heights.length && prev.heights.every((h, i) => h === heights[i])
          ? prev
          : { w, heights, settled },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const t of tileRefs.current.slice(0, n)) if (t) ro.observe(t);
    return () => ro.disconnect();
  }, [n, layoutKey]);

  const plan = planColumns(box?.w ?? 0, gap, { ...track, items: n });
  // Floored, never rounded: a track rounded up makes the columns a pixel or two wider than the box, whose scrollbar then
  // takes room, re-plans the tracks and goes again, flashing on and off.
  const colWidth = Math.floor(plan.colWidth);
  if (box?.settled) shownOnce.current = true;
  const show = box !== null && (box.settled || shownOnce.current);
  // Heights measured for another count of tiles (Rows just changed) place nothing: the layout effect measures the new
  // ones before the browser paints.
  const packed = box && box.heights.length === n ? packMasonry(box.heights, plan.count, gap) : null;
  return (
    <div ref={ref} className={className} style={{ position: "relative", ...(show && packed ? { height: packed.height } : {}) }}>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          ref={(t) => { tileRefs.current[i] = t; }}
          className="sol-record-tile"
          style={
            show && packed
              ? { position: "absolute", top: 0, left: 0, minWidth: 0, width: colWidth, transform: `translate(${packed.slots[i].col * (colWidth + gap)}px, ${Math.round(packed.slots[i].y)}px)` }
              : { position: "absolute", top: 0, left: 0, minWidth: 0, width: colWidth, visibility: "hidden" }
          }
        >
          {tile(i, colWidth)}
        </div>
      ))}
    </div>
  );
}
