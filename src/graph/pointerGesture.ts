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
  const isTouch = e.pointerType !== "mouse" && e.pointerType !== "pen";
  // A primary touch starts a new touch sequence, so no other finger is really down:
  // any finger still listed lost its `pointerup` and would fake a pinch.
  if (isTouch && e.isPrimary === true) {
    for (const [id, t] of down) if (t) down.delete(id);
  }
  down.set(e.pointerId, isTouch);
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
  // Bubble phase: in capture, `window` would also hear every element's blur.
  target.addEventListener("blur", resetPointerCensus);
  return () => {
    target.removeEventListener("pointerdown", add as EventListener, true);
    target.removeEventListener("pointerup", remove as EventListener, true);
    target.removeEventListener("pointercancel", remove as EventListener, true);
    target.removeEventListener("blur", resetPointerCensus);
  };
}

/** A window that loses focus gets no `pointerup` for what was down. */
export function resetPointerCensus(): void {
  down.clear();
}

if (typeof window !== "undefined") installPointerCensus(window);
