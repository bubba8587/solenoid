// The loop-guard behind main.tsx's `vite:preloadError` handler. A failed chunk
// load must reload AT MOST once per window, or a genuine network outage loops.
// The guard persists a timestamp across the reload (sessionStorage is the only
// client store that survives a reload AND is per-tab; an in-memory flag can't
// help, because a reload wipes memory). FAIL SAFE: if the guard can't be
// persisted, don't auto-reload at all.

export interface ReloadStore {
  /** Read the last-reload timestamp (may throw in private mode). */
  get: () => string | null;
  /** Persist the last-reload timestamp (may throw in private mode). */
  set: (value: string) => void;
}

/** Decide whether to reload for a failed chunk load, recording the attempt when
 *  we do. Returns false (don't reload) when already reloaded within `windowMs`,
 *  or when the store can't be read/written — the fail-safe that closes the
 *  private-browsing reload loop. */
export function shouldReloadForChunkError(
  now: number,
  store: ReloadStore,
  windowMs = 10_000,
): boolean {
  let last: number;
  try {
    last = Number(store.get() || 0);
  } catch {
    return false; // can't read the guard (private mode) → don't risk a loop
  }
  // An absent/garbage value means "never reloaded", so proceed regardless.
  if (Number.isFinite(last) && last > 0 && now - last < windowMs) return false;
  try {
    store.set(String(now));
  } catch {
    return false; // can't persist the guard → don't reload, or it would loop
  }
  return true;
}
