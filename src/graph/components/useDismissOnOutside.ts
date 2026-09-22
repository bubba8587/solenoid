// [[B14]] oneDesignSystem (DESIGN.md modal rules)
import { useEffect, useRef } from "react";

/** Close a popover when a pointerdown lands outside it. The OPENING element must be
 *  an "inside" ref too, or toggling it closed re-opens it on the button's onClick. */
export function useDismissOnOutside(
  active: boolean,
  onDismiss: () => void,
  insideRefs: Array<React.RefObject<HTMLElement | null>>,
) {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  const refs = useRef(insideRefs);
  refs.current = insideRefs;
  useEffect(() => {
    if (!active) return;
    const handler = (e: PointerEvent) => {
      // The path's first node, not `target`: a shadow root retargets `target` to its host, so
      // a press inside a panel that lives in one reads as outside ([[C107]] obsidianPlugin).
      const t = (e.composedPath()[0] ?? e.target) as Node | null;
      if (refs.current.some((r) => r.current && t && r.current.contains(t))) return;
      cb.current();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [active]);
}
