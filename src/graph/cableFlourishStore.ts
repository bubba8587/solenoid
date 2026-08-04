/** Bridges the main React root to the CableFlourish component, which registers its
 *  trigger on mount. */
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
