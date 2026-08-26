/** Bridge to the Add-node menu, which is local Canvas state; coords are SCREEN. */
type Opener = (screenX: number, screenY: number) => void;

let opener: Opener | null = null;

export const addMenuRequest = {
  // Nested (the drill-in registers over the main canvas); unregister restores the previous.
  register(fn: Opener) {
    const prev = opener;
    opener = fn;
    return () => { if (opener === fn) opener = prev; };
  },
  open(screenX: number, screenY: number) {
    opener?.(screenX, screenY);
  },
};
