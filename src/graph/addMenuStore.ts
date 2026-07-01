/**
 * Bridge so chrome outside the Canvas (the menu bar's Insert command) can open
 * the Add-node menu, which is local Canvas state. Canvas registers an opener on
 * mount; callers invoke `open(x, y)` with screen coords.
 */
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
