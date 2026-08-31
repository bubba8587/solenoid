// AUTHOR RULING (2026-08-26): on TOUCH, a one-finger drag on an UNSELECTED
// card or group PANS the canvas — a busy graph leaves no blank pixels to pan
// from otherwise. Selected nodes drag (tap-then-drag), matching the rete
// surface's touch guard. Mouse and pen keep select-and-drag in one motion.
//
// Owned in CAPTURE on the wrapper: the qualifying pointerdown is stopped so
// RF's node drag never starts, and the moves drive the camera directly. A
// second finger hands the gesture to flowPinch (touchCount governs).
import { touchCount } from "../pointerGesture";
import { touchSelectStore } from "../touchSelectStore";

type Viewport = { x: number; y: number; zoom: number };

/** Only DISCRETE controls keep their touch meaning (a tap fires them) and
 *  sockets keep the cable pick. Text fields deliberately do NOT veto: a tap
 *  still focuses them, but a DRAG from one pans — on an unselected card every
 *  non-actionable pixel is pan surface (the ruling's whole point). */
const CONTROL_SELECTOR = "button, select, .react-flow__handle, [data-socket-key]";

export function installTouchCardPan(
  el: HTMLElement,
  opts: {
    getViewport(): Viewport;
    setViewport(v: Viewport): void;
  },
): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startVp: Viewport | null = null;

  const dbg = (m: string) => (window as unknown as { __panLog?: string[] }).__panLog?.push(m);

  // The shared "this finger is ours" test: an UNSELECTED card or group, not on a
  // discrete control. RF stamps .selected on the wrapper — the one
  // synchronously-true source.
  const claims = (t: EventTarget | null): boolean => {
    const target = t as HTMLElement | null;
    const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
    if (!nodeEl) return false;
    if (nodeEl.classList.contains("selected")) return false;
    if (target?.closest?.(CONTROL_SELECTOR)) return false;
    return true;
  };

  // d3-drag starts node drags from TOUCHSTART (bubble, bound on the node) — the
  // pointer stream never reaches it, so the pointerdown stop below can't keep the
  // card still. (Unstopped it only LOOKS still in pan mode: the pan tracks the
  // finger 1:1, so the drag's flow-coordinate delta cancels to zero.) The tap's
  // click is pointer-derived and survives, so tap-select keeps working.
  const touchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    if (!claims(e.target)) return;
    e.stopPropagation();
  };

  const down = (e: PointerEvent) => {
    dbg(`down:${e.pointerType}:${touchCount()}:${String((e.target as HTMLElement)?.className).slice(0, 22)}`);
    if (e.pointerType !== "touch" || touchCount() > 1) return;
    if (!claims(e.target)) return;
    // SELECT mode: the gesture is dead on an unselected card (rete parity — no
    // pan, no drag), but the tap's click survives so tap-toggle still works.
    if (touchSelectStore.get()) {
      e.stopPropagation();
      return;
    }
    dbg("claimed");
    // Ours: RF's node drag (bubble on the node) never starts. No
    // preventDefault — the tap's click must still fire so tap-select works.
    e.stopPropagation();
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startVp = opts.getViewport();
  };

  const move = (e: PointerEvent) => {
    if (pointerId === null || e.pointerId !== pointerId || !startVp) return;
    // A second finger outranks the pan — flowPinch owns the gesture now.
    if (touchCount() >= 2) {
      pointerId = null;
      startVp = null;
      return;
    }
    e.stopPropagation();
    opts.setViewport({
      x: startVp.x + (e.clientX - startX),
      y: startVp.y + (e.clientY - startY),
      zoom: startVp.zoom,
    });
  };

  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    startVp = null;
  };

  el.addEventListener("touchstart", touchStart, true);
  el.addEventListener("pointerdown", down, true);
  el.addEventListener("pointermove", move, true);
  el.addEventListener("pointerup", up, true);
  el.addEventListener("pointercancel", up, true);
  return () => {
    el.removeEventListener("touchstart", touchStart, true);
    el.removeEventListener("pointerdown", down, true);
    el.removeEventListener("pointermove", move, true);
    el.removeEventListener("pointerup", up, true);
    el.removeEventListener("pointercancel", up, true);
  };
}
