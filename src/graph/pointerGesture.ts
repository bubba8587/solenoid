// ─── Live pointer census — is a pinch in flight, right now ──────────────────────
// The ONE definition of the two-finger gesture, read by everything that has to
// yield to it.
//
// WHY A MODULE SINGLETON ON WINDOW CAPTURE: the question has to be answerable from
// three unrelated places — rete's Zoom handler (a plugin instance), the area pipe
// (Canvas), and the lasso (a plain installer) — and it has to be answerable even
// when the pointer landed on something that swallowed the event. Capture phase on
// `window` is the only listener position that survives BOTH: it runs before the
// target phase, so no component's `stopPropagation()` can hide a contact from it,
// and it's global, so there's no ref to thread through three call sites.
//
// THE PINCH-PRIORITY RULE this exists to enforce (see areaPresets.ts CappedZoom):
// pinch is registered in CAPTURE and cannot be vetoed; pan/drag stay in BUBBLE and
// can be. So a control that wants the pointer for itself keeps stopping the event
// (no node drag, no canvas pan) and STILL can't break a two-finger zoom.

/** Contacts currently down, by pointerId, keeping only whether each is a FINGER.
 *  `PointerEvent.pointerType` is the spec's own vocabulary; a device reporting
 *  something else (or nothing) is treated as touch, since the only devices that
 *  omit it are touch digitizers. */
const down = new Map<number, boolean>();

/** Fingers currently down. A mouse and a pen are precise pointers and are excluded:
 *  neither can pinch, and counting them would let a stylus resting on the glass
 *  become the second "contact" of a zoom. */
export function touchCount(): number {
  let n = 0;
  for (const isTouch of down.values()) if (isTouch) n++;
  return n;
}

/**
 * A two-finger pinch/pan gesture is in flight — the single definition, so no caller
 * counts raw pointers for itself.
 *
 * NOTE this is deliberately blind to whether a stylus is also in contact. Solenoid
 * is a precise editor, not an inking surface: nobody rests a palm on a node graph,
 * so there is no palm to reject and the extra state that would take isn't earned.
 * If a drawing-style surface ever lands here, that decision is what to revisit.
 */
export function isPinching(): boolean {
  return touchCount() >= 2;
}

function add(e: PointerEvent): void {
  down.set(e.pointerId, e.pointerType !== "mouse" && e.pointerType !== "pen");
}

function remove(e: PointerEvent): void {
  down.delete(e.pointerId);
}

/** Install the census. Self-installing on import below — it must be live before any
 *  surface mounts, since a gesture can start on the very first frame. Exported for
 *  tests, which drive it against a fake window. */
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

/** Drop every tracked contact. A pointer can strand when the browser never delivers
 *  its `pointerup` (a contextmenu on long-press, a drag that leaves the window), and
 *  a stranded finger makes the NEXT gesture read as multi-touch. Canvas calls this
 *  once every contact is up. */
export function resetPointerCensus(): void {
  down.clear();
}

if (typeof window !== "undefined") installPointerCensus(window);
