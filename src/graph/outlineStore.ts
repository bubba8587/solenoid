/** Bridge for opening the Outline navigator focused on its search field;
 *  OutlinePanel registers the handler on mount. */
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
