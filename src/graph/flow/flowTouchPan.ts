// [[C93]] gestureByPointerType, [[C92]] pinchUnvetoable
import { touchCount } from "../pointerGesture";
import { touchSelectStore } from "../touchSelectStore";

type Viewport = { x: number; y: number; zoom: number };

const CONTROL_SELECTOR = "button, select, .react-flow__handle, [data-socket-key], .sol-rf-grip";

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

  const claims = (t: EventTarget | null): boolean => {
    const target = t as HTMLElement | null;
    const nodeEl = target?.closest?.(".react-flow__node") as HTMLElement | null;
    if (!nodeEl) return false;
    if (nodeEl.classList.contains("selected")) return false;
    if (target?.closest?.(CONTROL_SELECTOR)) return false;
    return true;
  };

  // d3-drag starts node drags from touchstart, which the pointerdown stop below never reaches; the tap's click survives.
  const touchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    if (!claims(e.target)) return;
    e.stopPropagation();
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || touchCount() > 1) return;
    if (!claims(e.target)) return;
    if (touchSelectStore.get()) {
      e.stopPropagation();
      return;
    }
    // No preventDefault: the tap's click must still fire so tap-select works.
    e.stopPropagation();
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startVp = opts.getViewport();
  };

  const move = (e: PointerEvent) => {
    if (pointerId === null || e.pointerId !== pointerId || !startVp) return;
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
