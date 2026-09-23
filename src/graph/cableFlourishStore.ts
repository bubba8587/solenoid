// [[B10]] reactFlowView (module-singleton store, storeKit)
let trigger: (() => void) | null = null;

export const cableFlourishBridge = {
  register(fn: () => void) {
    trigger = fn;
    return () => { if (trigger === fn) trigger = null; };
  },
  fire() {
    trigger?.();
  },
};
