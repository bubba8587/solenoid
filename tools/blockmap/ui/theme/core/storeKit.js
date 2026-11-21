// GENERATED from src/graph/storeKit.ts (d0597ab404bf) by tools/solenoid-theme/sync.mjs. Edit the source in Solenoid, then sync.
// [[A1]] visualGraphCalculator (the module-singleton stores are app-wide state)







export function createNotifier()           {
  const listeners = new Set            ();
  let v = 0;
  return {
    notify() { v++; for (const l of listeners) l(); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => v,
  };
}










export function createToggleStore(initial = false)              {
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
export function readSaved(key        )                {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Keeps `text` per viewer under `key`. Storage can be missing or throw (private mode, quota), and then the state lives
 *  in memory only. */
export function writeSaved(key        , text        )       {
  try { localStorage.setItem(key, text); } catch { /* in memory only */ }
}

/** A toggle kept per viewer under `key` ("1" or "0"); `load` reads it back at startup. */
export function createSavedToggle(key        )                                     {
  const store = createToggleStore();
  store.subscribe(() => writeSaved(key, store.get() ? "1" : "0"));
  return {
    ...store,
    load: () => store.set(readSaved(key) === "1"),
  };
}









export function createValueStore   ()                {
  const { notify, subscribe, version } = createNotifier();
  let value           = null;
  return {
    get: () => value,
    open(v) { value = v; notify(); },
    close() { if (value === null) return; value = null; notify(); },
    subscribe,
    version,
  };
}
