// ─── Live pointer census — what gesture is in flight, right now ─────────────────
// The ONE place that answers "is this a pinch / is a pen down / how many fingers".
// Everything that needs to yield to a pinch reads it from here.
//
// WHY A MODULE SINGLETON ON WINDOW CAPTURE: a gesture question has to be answerable
// from three unrelated places — rete's Zoom handler (a plugin instance), the area
// pipe (Canvas), and the lasso (a plain installer) — and it has to be answerable
// even when the pointer landed on something that swallowed the event. Capture phase
// on `window` is the only listener position that survives BOTH: it runs before the
// target phase, so no component's `stopPropagation()` can hide a contact from it,
// and it's global, so there's no ref to thread through three call sites.
//
// THE PINCH-PRIORITY RULE this exists to enforce (see areaPresets.ts CappedZoom):
// pinch is registered in CAPTURE and cannot be vetoed; pan/drag stay in BUBBLE and
// can be. So a control that wants the pointer for itself keeps stopping the event
// (no node drag, no canvas pan) and STILL can't break a two-finger zoom.

/** What a contact is. `PointerEvent.pointerType` is the spec's own vocabulary; a
 *  device that reports something else (or nothing) is treated as touch, since the
 *  only devices that report an unknown type are touch digitizers. */
type Kind = "mouse" | "pen" | "touch";

const kindOf = (e: PointerEvent): Kind =>
  e.pointerType === "mouse" || e.pointerType === "pen" ? e.pointerType : "touch";

/** Every contact currently down, by pointerId. */
const down = new Map<number, Kind>();

function count(kind: Kind): number {
  let n = 0;
  for (const k of down.values()) if (k === kind) n++;
  return n;
}

/** A stylus is in contact. While true, touch contacts are treated as PALM and are
 *  ignored by the canvas gestures — see `isPinching` / `isPalmContact`. */
export function penActive(): boolean {
  return count("pen") > 0;
}

/** Fingers currently down (pen and mouse excluded). */
export function touchCount(): number {
  return count("touch");
}

/** Contacts of every kind — the raw count, for callers that genuinely mean "more
 *  than one thing is touching" rather than "a pinch is happening". */
export function pointerCount(): number {
  return down.size;
}

/**
 * A two-finger pinch/pan gesture is in flight.
 *
 * TWO fingers, and NO pen: a stylus resting on the glass with a palm down is not a
 * pinch, and treating it as one is the classic tablet failure — the canvas zooms
 * out from under a drawing hand. A pen therefore never counts toward the gesture
 * AND suppresses it outright.
 */
export function isPinching(): boolean {
  return !penActive() && touchCount() >= 2;
}

/**
 * This contact should be ignored because a stylus is doing the work — i.e. it's a
 * palm. Only touch is ever rejected: a mouse or a second pen is deliberate.
 *
 * LIMITATION (deliberate, documented rather than half-solved): rejection is
 * forward-only. A palm that lands BEFORE the pen tip — the common grip — is already
 * registered by the time `penActive()` flips, so it isn't retroactively undone. What
 * we do instead is let the pen CANCEL the gesture the palm started (`onPenDown`), so
 * the palm can begin something but never finish it. Full rejection needs contact
 * geometry (`width`/`height`/`pressure`), which is worth doing only if the light
 * version proves insufficient on real hardware.
 */
export function isPalmContact(e: PointerEvent): boolean {
  return kindOf(e) === "touch" && penActive();
}

/** Fired when a pen makes contact, so an in-flight touch gesture (a lasso a palm
 *  started, a node drag) can bail. Subscribers are permanent — this is app chrome,
 *  not per-render state. */
const penDownSubs = new Set<() => void>();
export function onPenDown(fn: () => void): () => void {
  penDownSubs.add(fn);
  return () => penDownSubs.delete(fn);
}

function add(e: PointerEvent): void {
  const kind = kindOf(e);
  down.set(e.pointerId, kind);
  if (kind === "pen") for (const fn of penDownSubs) fn();
}

function remove(e: PointerEvent): void {
  down.delete(e.pointerId);
}

/** Install the census. Idempotent, and self-installing on import below — the census
 *  must be live before any surface mounts, since a gesture can start on the very
 *  first frame. Exported for tests, which drive it against a fake window. */
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

/** Drop every tracked contact. The gesture trackers that read this census can strand
 *  a pointer when the browser never delivers its `pointerup` (a contextmenu on
 *  long-press, a drag that leaves the window), and a stranded finger makes the NEXT
 *  gesture read as multi-touch. Canvas calls this once every contact is up. */
export function resetPointerCensus(): void {
  down.clear();
}

if (typeof window !== "undefined") installPointerCensus(window);
