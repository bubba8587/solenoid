// [[C95]] commitOnEnter
// A <tbody>'s rows windowed to the scroll view by TanStack Virtual: spacer rows stand in for the rest.
import { useEffect, useReducer, type ReactNode, type RefObject } from "react";
import { useVirtualizer, defaultRangeExtractor, type Virtualizer } from "@tanstack/react-virtual";

const ROW_ESTIMATE_PX = 28;

/** The grid's body rows inside the scroll window, with spacer rows standing in for the rest; `pinned` always draws. */
export function VirtualRows({ count, scrollRef, virtualRef, colSpan, pinned, row }: {
  count: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualRef: { current: Virtualizer<HTMLDivElement, HTMLTableRowElement> | null };
  colSpan: number;
  pinned: number;
  row: (vi: number, measure: (el: HTMLTableRowElement | null) => void) => ReactNode;
}) {
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 12,
    rangeExtractor: (range) => {
      const out = defaultRangeExtractor(range);
      return pinned >= 0 && pinned < count && !out.includes(pinned) ? [...out, pinned].sort((a, b) => a - b) : out;
    },
  });
  virtualRef.current = virtualizer;
  // The parent's scroll box gets its ref after this child's layout effects, so the first pass finds none: one re-render picks it up.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { if (virtualizer.scrollElement !== scrollRef.current) rerender(); });
  const items = virtualizer.getVirtualItems();
  const spacer = (h: number, key: string) => (h > 0 ? <tr key={key} aria-hidden="true" className="table-popup__spacer"><td colSpan={colSpan} style={{ height: h, padding: 0, border: 0 }} /></tr> : null);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const item of items) {
    out.push(spacer(item.start - cursor, `gap-${item.index}`));
    out.push(row(item.index, virtualizer.measureElement));
    cursor = item.end;
  }
  out.push(spacer(virtualizer.getTotalSize() - cursor, "gap-end"));
  return <>{out}</>;
}
