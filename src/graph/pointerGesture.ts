// [[C92]] pinchUnvetoable: the ONE finger census, on `window` in CAPTURE so no
// component's `stopPropagation()` can hide a contact.

/** Contacts down by pointerId, keeping only whether each is a FINGER; a device
 *  reporting no `pointerType` is treated as touch (only digitizers omit it). */
const down = new Map<number, boolean>();

/** Mouse and pen are excluded ([[C93]] gestureByPointerType: a pen is precise). */
export function touchCount(): number {
  let n = 0;
  for (const isTouch of down.values()) if (isTouch) n++;
  return n;
}

/** The single definition, so no caller counts raw pointers for itself. */
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
