// Shared kernel for the module-level "external stores" the app reads through
// useSyncExternalStore. Rete renders node components in a separate React root,
// so any state both roots touch lives in these module singletons instead of
// React context. Every store needs the same listener plumbing — a Set of
// callbacks, a notify() that fans out, and a subscribe() returning an
// unsubscribe — plus, for stores whose snapshot is "did anything change?", a
// monotonic version counter.
//
// createNotifier() is that plumbing. createToggleStore() is the further-shared
// shape for the handful of boolean open/closed flag stores, and
// createValueStore() the one for the "current value or null (closed)" popup /
// dialog stores.

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

/** A boolean open/closed flag store — the shape shared by the Function
 *  Reference / shortcuts overlays, the mobile menu, touch-select mode, the
 *  canvas lock, and the settings panel. set/open/close no-op when unchanged;
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
  /** Set the value (replacing any previous one) and notify. */
  open: (value: T) => void;
  /** Clear the value; no-op when already closed. */
  close: () => void;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

/** A "current value or null (closed)" store — the shape shared by the popup and
 *  dialog stores (table/chart/cube/formula popups, the connection dialog, the
 *  element picker, the pivot editor). Stores with extra verbs or a non-standard
 *  open (cubePopup's drill/backTo, formulaPopup's same-id dedupe) spread the
 *  core and layer them on via get()/open(). */
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
