// [[C127]] pivotView, [[C128]] pivotDetails
import type { FrameValue } from "./frame";

const tables: WeakMap<FrameValue, unknown>[] = [];

/** A view's side info kept beside a frame in a table keyed by the frame object, never on it, so no other node sees it. `fits` refuses info the frame no longer matches. */
export function frameSidecar<T>(fits: (f: FrameValue, info: T) => boolean): { set: (f: FrameValue, info: T) => void; of: (f: FrameValue) => T | null } {
  const table = new WeakMap<FrameValue, T>();
  tables.push(table);
  return {
    set: (f, info) => { table.set(f, info); },
    of: (f) => {
      const info = table.get(f);
      return info !== undefined && fits(f, info) ? info : null;
    },
  };
}

/** A copy of a frame (a format stamp) keeps every side info the original had. */
export function carryFrameSidecars(from: FrameValue, to: FrameValue): void {
  if (from === to) return;
  for (const t of tables) {
    const info = t.get(from);
    if (info !== undefined) t.set(to, info);
  }
}
