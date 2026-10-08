// [[B14]] oneDesignSystem (DESIGN.md modal rules)
// An open menu inside a popup takes Escape before the popup does, so Escape closes the menu, not the popup.
import { useEffect, useRef } from "react";

const layers: Array<{ close: () => void }> = [];

/** Closes the topmost open menu; false when none is open. */
export function consumeEscape(): boolean {
  const top = layers[layers.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** While `open`, Escape closes this menu first. */
export function useEscapeLayer(open: boolean, close: () => void): void {
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    if (!open) return;
    const layer = { close: () => cb.current() };
    layers.push(layer);
    return () => { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); };
  }, [open]);
}
