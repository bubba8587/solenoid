// [[C95]] commitOnEnter, [[B12]] losslessSaves
import { useEffect, useRef } from "react";

const pending = new Map<object, () => void>();

/** Commits every open draft, as if its field had blurred. A document switch, a file save and the page closing call it before they capture. */
export function flushDrafts(): boolean {
  const flushes = [...pending.values()];
  pending.clear();
  for (const f of flushes) {
    try { f(); } catch (e) { console.error("[solenoid] draft flush failed", e); }
  }
  return flushes.length > 0;
}

export function registerPendingDraft(key: object, flush: () => void): () => void {
  pending.set(key, flush);
  return () => { if (pending.get(key) === flush) pending.delete(key); };
}

/** Registers `flush` while `dirty`; the latest closure runs, so it commits the latest draft. */
export function usePendingDraft(dirty: boolean, flush: () => void): void {
  const latest = useRef(flush);
  latest.current = flush;
  const key = useRef({}).current;
  useEffect(() => {
    if (!dirty) return;
    return registerPendingDraft(key, () => latest.current());
  }, [dirty, key]);
}
