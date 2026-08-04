// Rete renders node components in a SEPARATE React root, so any state both roots
// touch must live in these module singletons rather than React context.

export interface Notifier {
  /** Call after mutating state to re-render subscribers (also bumps version). */
  notify: () => void;
  /** useSyncExternalStore subscribe: registers a listener, returns unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** Monotonic snapshot that changes on every notify(). */
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

export interface ToggleStore {
  get: () => boolean;
  set: (v: boolean) => void;
  open: () => void;
  close: () => void;
  toggle: () => void;
  subscribe: (listener: () => void) => () => void;
}

/** A boolean open/closed flag store. set/open/close no-op when unchanged;
 *  toggle always flips. */
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

export interface ValueStore<T> {
  /** The current value, or null when closed. */
  get: () => T | null;
  open: (value: T) => void;
  /** No-op when already closed. */
  close: () => void;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

/** Stores needing extra verbs spread this core and layer them on via get()/open(). */
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
