/**
 * Bridge so the app bar's search affordance can open the Outline navigator and
 * focus its search field. OutlinePanel registers a handler on mount; callers
 * invoke `open()`.
 */
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
