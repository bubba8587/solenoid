// Lazy KaTeX loader: consumers get the renderer or null (raw text meanwhile). This
// module must stay katex-free, or importing it drags katex into the main bundle.
import { useSyncExternalStore } from "react";
import type { KatexOptions } from "katex";

export type TexRenderer = (latex: string, options?: KatexOptions) => string;

let cached: TexRenderer | null = null;
let started = false;
const listeners = new Set<() => void>();

function load(): void {
  if (started) return;
  started = true;
  void import("./katexRender").then((m) => {
    cached = m.renderTex;
    listeners.forEach((l) => l());
  });
}

/** Sync accessor for non-hook callers: kicks off the one-time load, null until it
 *  lands — a subscribed ancestor re-renders the subtree then. */
export function getKatexRenderer(): TexRenderer | null {
  load();
  return cached;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const snapshot = () => cached;

/** Triggers the load and re-renders when katex arrives; null while loading. */
export function useKatexRender(): TexRenderer | null {
  const r = useSyncExternalStore(subscribe, snapshot);
  load();
  return r;
}
