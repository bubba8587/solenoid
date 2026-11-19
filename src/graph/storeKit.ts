// [[A1]] visualGraphCalculator (the module-singleton stores are app-wide state)

interface Notifier {
  notify: () => void;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

export function createNotifier(): Notifier {
  const listeners = new Set<() => void>();
  let v = 0;
  return {
    notify() { v++; for (const l of listeners) l(); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => v,
  };
}

interface ToggleStore {
  get: () => boolean;
  set: (v: boolean) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  subscribe: (listener: () => void) => () => void;
}

export function createToggleStore(initial = false): ToggleStore {
  const { notify, subscribe } = createNotifier();
  let on = initial;
  return {
    get: () => on,
    set: (v) => { if (on !== v) { on = v; notify(); } },
    open: () => { if (!on) { on = true; notify(); } },
    close: () => { if (on) { on = false; notify(); } },
    toggle: () => { on = !on; notify(); },
    subscribe,
  };
}

/** The text kept per viewer under `key`, or null when there is none. Storage can be missing or throw (private mode),
 *  which reads as none. Every store's saved state goes through this and `writeSaved`. */
export function readSaved(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Keeps `text` per viewer under `key`. Storage can be missing or throw (private mode, quota), and then the state lives
 *  in memory only. */
export function writeSaved(key: string, text: string): void {
  try { localStorage.setItem(key, text); } catch { /* in memory only */ }
}

/** A toggle kept per viewer under `key` ("1" or "0"); `load` reads it back at startup. */
export function createSavedToggle(key: string): ToggleStore & { load: () => void } {
  const store = createToggleStore();
  store.subscribe(() => writeSaved(key, store.get() ? "1" : "0"));
  return {
    ...store,
    load: () => store.set(readSaved(key) === "1"),
  };
}

interface ValueStore<T> {
  get: () => T | null;
  open: (value: T) => void;
  close: () => void;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

export function createValueStore<T>(): ValueStore<T> {
  const { notify, subscribe, version } = createNotifier();
  let value: T | null = null;
  return {
    get: () => value,
    open(v) { value = v; notify(); },
    close() { if (value === null) return; value = null; notify(); },
    subscribe,
    version,
  };
}
