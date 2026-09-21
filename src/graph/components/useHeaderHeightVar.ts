// [[B14]] oneDesignSystem
import { useLayoutEffect, type RefObject } from "react";

/** Publish the header's border-box height on the card as `--header-h`.
 *  Fractional when the layout height is — the frame divider must sit exactly on
 *  the seam, and offsetHeight's rounding would put it up to half a px off.
 *  Consumers: the frame SVG's header viewport, the corner badge's `top`. */
export function useHeaderHeightVar(headerRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    const card = header?.parentElement;
    if (!header || !card) return;
    const apply = (h: number) => card.style.setProperty("--header-h", `${h}px`);
    apply(header.offsetHeight);
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      apply(box ? box.blockSize : header.offsetHeight);
    });
    ro.observe(header);
    return () => ro.disconnect();
  }, [headerRef]);
}
