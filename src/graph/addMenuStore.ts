// [[B10]] reactFlowView (module-singleton store, storeKit)
type Opener = (screenX: number, screenY: number) => void;

let opener: Opener | null = null;

export const addMenuRequest = {
  register(fn: Opener) {
    const prev = opener;
    opener = fn;
    return () => { if (opener === fn) opener = prev; };
  },
  open(screenX: number, screenY: number) {
    opener?.(screenX, screenY);
  },
};
