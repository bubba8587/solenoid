import { useEffect, useRef } from "react";

/**
 * Close a popover (color picker, dropdown, …) when a pointerdown lands outside it.
 *
 * Uses a CAPTURE-phase document listener + DOM containment rather than relying on
 * the popover's own `stopPropagation`, so it works regardless of what child
 * handlers do and across Rete's separate React roots (still one DOM document).
 * The opening element (e.g. the swatch button) must be passed as an "inside" ref
 * too, otherwise clicking it to toggle the popover closed would re-open it: the
 * capture handler would dismiss on pointerdown, then the button's onClick toggles
 * it back on.
 *
 * Only attaches while `active`. `onDismiss` is read through a ref so an inline
 * callback doesn't re-bind the listener every render.
 */
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
      const t = e.target as Node | null;
      if (refs.current.some((r) => r.current && t && r.current.contains(t))) return;
      cb.current();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [active]);
}
