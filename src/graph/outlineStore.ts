// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
let handler: (() => void) | null = null;

export const outlineSearch = {
  register(fn: () => void) {
    handler = fn;
    return () => { if (handler === fn) handler = null; };
  },
  open() {
    handler?.();
  },
};

let filesHandler: (() => void) | null = null;

/** Opens the Navigator on its Files section, the open document's row in view. */
export const navigatorFiles = {
  register(fn: () => void) {
    filesHandler = fn;
    return () => { if (filesHandler === fn) filesHandler = null; };
  },
  open() {
    filesHandler?.();
  },
};
