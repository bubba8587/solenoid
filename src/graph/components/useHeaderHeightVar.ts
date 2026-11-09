// [[B14]] oneDesignSystem
import { useLayoutEffect, type RefObject } from "react";
import { measureThenWrite, observeResize } from "./layoutBatch";

/** Fractional when the layout height is: the frame divider must sit exactly on the seam, and offsetHeight's rounding would put it up to half a pixel off. */
export function useHeaderHeightVar(headerRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    const card = header?.parentElement;
    if (!header || !card) return;
    const apply = (h: number) => card.style.setProperty("--header-h", `${h}px`);
    measureThenWrite(headerRef, () => header.offsetHeight, apply);
    return observeResize(header, (entry) => {
      const box = entry.borderBoxSize?.[0];
      apply(box ? box.blockSize : header.offsetHeight);
    });
  }, [headerRef]);
}
