// [[B14]] oneDesignSystem (DESIGN.md modal rules)
import { useEffect, useRef } from "react";

/** `onClose` is read through a ref, so an inline callback doesn't re-bind the listener; `capture: true` both registers on the capture phase and swallows the browser default. */
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
