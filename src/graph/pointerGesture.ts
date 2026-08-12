// The ONE definition of the two-finger gesture. It listens on `window` in CAPTURE so
// no component's `stopPropagation()` can hide a contact — the pinch-priority rule
// (pinch in capture, un-vetoable; pan/drag in bubble, vetoable) depends on it.

/** Contacts down by pointerId, keeping only whether each is a FINGER; a device
 *  reporting no `pointerType` is treated as touch (only digitizers omit it). */
const down = new Map<number, boolean>();

/** Mouse and pen are excluded: neither can pinch, and counting them would let a
 *  resting stylus become the second "contact" of a zoom. */
export function touchCount(): number {
  let n = 0;
  for (const isTouch of down.values()) if (isTouch) n++;
  return n;
}

/** The single definition, so no caller counts raw pointers for itself; deliberately
 *  blind to a stylus in contact — a node graph has no palm to reject. */
export function isPinching(): boolean {
  return touchCount() >= 2;
}

function add(e: PointerEvent): void {
  down.set(e.pointerId, e.pointerType !== "mouse" && e.pointerType !== "pen");
}

function remove(e: PointerEvent): void {
  down.delete(e.pointerId);
}

/** Self-installing on import below: it must be live before any surface mounts,
 *  since a gesture can start on the very first frame. */
export function installPointerCensus(target: Pick<Window, "addEventListener" | "removeEventListener">): () => void {
  target.addEventListener("pointerdown", add as EventListener, true);
  target.addEventListener("pointerup", remove as EventListener, true);
  target.addEventListener("pointercancel", remove as EventListener, true);
  return () => {
    target.removeEventListener("pointerdown", add as EventListener, true);
    target.removeEventListener("pointerup", remove as EventListener, true);
    target.removeEventListener("pointercancel", remove as EventListener, true);
  };
}

/** A pointer strands when the browser never delivers its `pointerup`, and a stranded
 *  finger makes the NEXT gesture read as multi-touch — Canvas resets once all are up. */
export function resetPointerCensus(): void {
  down.clear();
}

if (typeof window !== "undefined") installPointerCensus(window);
