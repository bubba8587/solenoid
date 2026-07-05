// Lazy loader for KaTeX. renderToString is synchronous, so consumers get either the
// real renderer (once the chunk arrives) or null — and fall back to raw formula text
// in the meantime, snapping to typeset math a beat later. This module stays katex-free
// so importing it doesn't drag katex into the main bundle; katexRender.ts holds it.
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

/** Sync accessor for module-level (non-hook) helpers. Kicks off the one-time load
 *  and returns the renderer once available, else null (caller shows raw text). A
 *  subscribed ancestor re-renders the subtree when the load completes. */
export function getKatexRenderer(): TexRenderer | null {
  load();
  return cached;
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const snapshot = () => cached;

/** Hook: triggers the load and re-renders the component when katex arrives. Returns
 *  the renderer, or null while still loading. */
export function useKatexRender(): TexRenderer | null {
  const r = useSyncExternalStore(subscribe, snapshot);
  load();
  return r;
}
