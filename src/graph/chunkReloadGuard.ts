// The loop-guard behind main.tsx's `vite:preloadError` handler, extracted as a
// pure function so it's unit-testable (main.tsx runs boot code on import, so its
// handler can't be imported into a test).
//
// A code-split chunk that fails to LOAD is almost always a stale hash after a new
// deploy — reloading once pulls fresh chunk refs. But a genuine network outage
// makes the reload fail again, so we must reload AT MOST once per window. The
// guard persists a timestamp across the reload; sessionStorage is the only client
// store that survives a reload AND is per-tab. In private browsing it can throw on
// read or write — and an in-memory flag can't help, because a reload wipes memory.
// So we FAIL SAFE: if the guard can't be persisted, don't auto-reload at all (the
// user can reload by hand) rather than risk an endless reload loop.

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
  // Guard only on a REAL recorded timestamp (last > 0); an absent/garbage value
  // means "never reloaded", so proceed regardless of the window.
  if (Number.isFinite(last) && last > 0 && now - last < windowMs) return false;
  try {
    store.set(String(now));
  } catch {
    return false; // can't persist the guard → don't reload, or it would loop
  }
  return true;
}
