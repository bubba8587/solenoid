// [[A1]] visualGraphCalculator (module-singleton store, storeKit)
type Opener = (screenX: number, screenY: number) => void;

let opener: Opener | null = null;
let closer: (() => void) | null = null;
let isOpen = false;

export const addMenuRequest = {
  register(fn: Opener, close?: () => void) {
    const prev = opener, prevClose = closer;
    opener = fn;
    closer = close ?? null;
    return () => { if (opener === fn) { opener = prev; closer = prevClose; } };
  },
  open(screenX: number, screenY: number) {
    opener?.(screenX, screenY);
  },
  /** The phone's + button: a second tap closes the menu instead of reopening it. */
  toggle(screenX: number, screenY: number) {
    if (isOpen && closer) closer();
    else opener?.(screenX, screenY);
  },
  /** Set by the menu itself on mount and unmount. */
  setOpen(open: boolean) { isOpen = open; },
};
