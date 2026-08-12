// Loop-guard behind main.tsx's `vite:preloadError` handler: reload AT MOST once per
// window, and if the timestamp can't be persisted don't auto-reload at all.

export interface ReloadStore {
  /** Read the last-reload timestamp (may throw in private mode). */
  get: () => string | null;
  /** Persist the last-reload timestamp (may throw in private mode). */
  set: (value: string) => void;
}

/** Records the attempt when it returns true; false when already reloaded within
 *  `windowMs` or the store can't be read/written (the private-browsing fail-safe). */
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
  if (Number.isFinite(last) && last > 0 && now - last < windowMs) return false;
  try {
    store.set(String(now));
  } catch {
    return false; // can't persist the guard → don't reload, or it would loop
  }
  return true;
}
