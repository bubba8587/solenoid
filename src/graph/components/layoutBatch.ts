// [[C120]] linearWork
import { flushSync } from "react-dom";

type Job = { read: () => unknown; write: (value: unknown) => void };

const jobs = new Map<object, Job>();
let queued = false;

/** Queues a layout read and the write it feeds, keyed by `owner` so a re-render replaces its own job. A commit's jobs
 *  run together before paint: every read, then every write, so a load of hundreds of cards lays out once, not once per
 *  card. State the writes set commits synchronously, before the frame. */
export function measureThenWrite<T>(owner: object, read: () => T, write: (value: T) => void): void {
  jobs.set(owner, { read, write: write as (value: unknown) => void });
  if (queued) return;
  queued = true;
  queueMicrotask(flush);
}

function flush(): void {
  queued = false;
  const batch = [...jobs.values()];
  jobs.clear();
  const values = batch.map((j) => j.read());
  flushSync(() => {
    batch.forEach((j, i) => j.write(values[i]));
  });
}

type ResizeHandler = (entry: ResizeObserverEntry) => void;
const resizeHandlers = new Map<Element, ResizeHandler>();
let sharedResizeObserver: ResizeObserver | null = null;

/** One ResizeObserver for every card: the browser hands a frame's resizes to one callback, so a load that sizes
 *  hundreds of cards re-renders them in one commit, where an observer per card commits once per card. */
export function observeResize(el: Element, handler: ResizeHandler): () => void {
  sharedResizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) resizeHandlers.get(entry.target)?.(entry);
  });
  resizeHandlers.set(el, handler);
  sharedResizeObserver.observe(el);
  return () => {
    resizeHandlers.delete(el);
    sharedResizeObserver?.unobserve(el);
  };
}
