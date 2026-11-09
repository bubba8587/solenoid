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

/** A toggle kept per viewer under `key` ("1" or "0"); `load` reads it back at startup. Storage can be missing or
 *  throw (private mode, quota), and then the toggle lives in memory only. */
export function createSavedToggle(key: string): ToggleStore & { load: () => void } {
  const store = createToggleStore();
  store.subscribe(() => {
    try { localStorage.setItem(key, store.get() ? "1" : "0"); } catch { /* in memory only */ }
  });
  return {
    ...store,
    load: () => {
      try { store.set(localStorage.getItem(key) === "1"); } catch { /* in memory only */ }
    },
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
