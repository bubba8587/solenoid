/** Bridge to the Add-node menu, which is local Canvas state; coords are SCREEN. */
type Opener = (screenX: number, screenY: number) => void;

let opener: Opener | null = null;

export const addMenuRequest = {
  register(fn: Opener) {
    opener = fn;
    return () => { if (opener === fn) opener = null; };
  },
  open(screenX: number, screenY: number) {
    opener?.(screenX, screenY);
  },
};
