/**
 * Module-level bridge so chrome rendered in the main React root (NavMenu) can
 * fire the decorative cable flourish, whose trigger lives inside the
 * CableFlourish component. CableFlourish registers its trigger on mount;
 * callers invoke `fire()`.
 */
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
