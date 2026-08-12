import { useEffect, useRef } from "react";

/** Close an overlay on window-level Escape; `onClose` is read through a ref so an inline
 *  callback doesn't re-bind the listener every render. `capture: true` registers on the
 *  capture phase AND swallows the browser default — the two always travel together. */
export function useEscapeToClose(
  onClose: () => void,
  active = true,
  opts?: { capture?: boolean },
) {
  const cb = useRef(onClose);
  cb.current = onClose;
  const capture = opts?.capture ?? false;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (capture) e.preventDefault();
      cb.current();
    };
    window.addEventListener("keydown", handler, capture);
    return () => window.removeEventListener("keydown", handler, capture);
  }, [active, capture]);
}
