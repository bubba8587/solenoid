// [[B14]] oneDesignSystem
import { useEffect, useState } from "react";

/**
 * False until the frame after `key` first appears, then true until it changes: a popup renders its shell and a
 * skeleton on open, the browser paints that, and only then does the heavy body render. Null (closed) resets it, so
 * reopening the same thing shows the skeleton again.
 */
export function useAfterPaint(key: unknown): boolean {
  const [readyFor, setReadyFor] = useState<unknown>(null);
  useEffect(() => {
    if (key == null) { setReadyFor(null); return; }
    let timer = 0;
    // A rAF runs before the next paint; the timeout it queues runs after it.
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => setReadyFor(key), 0); });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [key]);
  return key != null && readyFor === key;
}

/** Resolves after the browser has painted what is on screen now: work started after it can't hold a popup's skeleton back. */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/** The loading placeholder a popup shows while its body renders or its data arrives: one neutral shimmering block. */
export function PopupSkeleton() {
  return <div className="sol-skeleton" role="status" aria-label="Loading"><span className="sol-skeleton__block" /></div>;
}
