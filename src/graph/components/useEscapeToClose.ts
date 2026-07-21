import { useEffect, useRef } from "react";

/**
 * Close an overlay when Escape is pressed anywhere in the window — the shared
 * dismiss gesture every popup/panel here wires. Attaches only while `active`.
 * `onClose` is read through a ref so an inline callback doesn't re-bind the
 * listener every render (this also keeps the handler seeing the latest render's
 * state).
 *
 * `capture: true` is for the modal popups that must own the key ahead of any
 * other handler (the canvas keydown, a focused field): it registers on the
 * capture phase AND swallows the browser default (`preventDefault`). Every
 * capture-phase site here does both and every bubble-phase site does neither,
 * so the two travel as one switch.
 */
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
