// [[C68]] knapIsTheDocumentSyntax
// This module must stay katex-free, or importing it drags katex into the main bundle.
import { useSyncExternalStore } from "react";
import type { KatexOptions } from "katex";

export type TexRenderer = (latex: string, options?: KatexOptions) => string;

let cached: TexRenderer | null = null;
let loading: Promise<TexRenderer> | null = null;
const listeners = new Set<() => void>();

/** Loads the chunk once and fills the cache the sync accessors read. */
export function loadKatexRenderer(): Promise<TexRenderer> {
  loading ??= import("./katexRender").then((m) => {
    cached = m.renderTex;
    listeners.forEach((l) => l());
    return m.renderTex;
  });
  return loading;
}

function load(): void {
  void loadKatexRenderer();
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

/** Re-renders when katex arrives WITHOUT starting the load (a note renderer starts it
 *  only on meeting a formula), so a plain note never pulls the chunk. */
export function useKatexReady(): TexRenderer | null {
  return useSyncExternalStore(subscribe, snapshot);
}

export function useKatexRender(): TexRenderer | null {
  const r = useSyncExternalStore(subscribe, snapshot);
  load();
  return r;
}
