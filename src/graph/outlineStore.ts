// [[B10]] reactFlowView (module-singleton store, storeKit)
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
