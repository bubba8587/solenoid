// [[B2]] webTryDesktopFull (a stale lazy chunk after a deploy)
// Reload at most once per window, and never auto-reload when the timestamp can't be persisted.

export interface ReloadStore {
  /** May throw in private mode. */
  get: () => string | null;
  /** May throw in private mode. */
  set: (value: string) => void;
}

/** Records the attempt when it returns true. */
export function shouldReloadForChunkError(
  now: number,
  store: ReloadStore,
  windowMs = 10_000,
): boolean {
  let last: number;
  try {
    last = Number(store.get() || 0);
  } catch {
    return false;
  }
  if (Number.isFinite(last) && last > 0 && now - last < windowMs) return false;
  try {
    store.set(String(now));
  } catch {
    return false;
  }
  return true;
}
