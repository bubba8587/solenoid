// [[C92]] pinchUnvetoable, [[C93]] gestureByPointerType

const down = new Map<number, boolean>();

export function touchCount(): number {
  let n = 0;
  for (const isTouch of down.values()) if (isTouch) n++;
  return n;
}

export function isPinching(): boolean {
  return touchCount() >= 2;
}

function add(e: PointerEvent): void {
  const isTouch = e.pointerType !== "mouse" && e.pointerType !== "pen";
  if (isTouch && e.isPrimary === true) {
    for (const [id, t] of down) if (t) down.delete(id);
  }
  down.set(e.pointerId, isTouch);
}

function remove(e: PointerEvent): void {
  down.delete(e.pointerId);
}

/** Installs on import, because a gesture can start on the very first frame, before any surface mounts. */
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

export function resetPointerCensus(): void {
  down.clear();
}

if (typeof window !== "undefined") installPointerCensus(window);
