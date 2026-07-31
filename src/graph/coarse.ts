// Touch-vs-mouse helpers shared across node chrome.

/** True when the primary pointer is touch (phone/tablet). Evaluated once. */
export const IS_COARSE =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/** True when the user has asked the OS to minimize motion. Checked on CALL (not
 *  cached) so a mid-session OS toggle takes effect on the next load. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** True when the browser identifies itself as a mobile device. A mobile
 *  browser's "Request desktop site" swaps to a desktop UA, flipping this
 *  false — the lever users pull to opt OUT of the mobile experience. */
const IS_MOBILE_UA =
  typeof navigator !== "undefined" &&
  ((navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent));

/**
 * THE mobile-mode flag — the single gate for every mobile behavior (tap-to-
 * select, drag-only-selected, touch hit widths, autofocus suppression, the
 * mobile chrome). Requires BOTH a touch-primary pointer and a mobile UA, so
 * "Request desktop site" (which changes only the UA) yields the full desktop
 * app on a phone. main.tsx mirrors this onto `html.is-mobile`, which gates
 * all the mobile CSS — keep the two in lockstep by deriving, never duplicating.
 */
export const IS_MOBILE = IS_COARSE && IS_MOBILE_UA;

/**
 * THE tablet flag: a touch-primary device that is NOT in mobile mode. iPadOS
 * ships a desktop UA by default and that is deliberate (see IS_MOBILE), so a
 * tablet deliberately runs the DESKTOP interaction model and the desktop chrome
 * — which means it never gets the mobile bottom action bar, and a tablet user
 * has no touch target for delete / group / select-mode / undo / the palette.
 * The top bar grows them instead (`TabletActions`, gated on `html.is-tablet`).
 *
 * Derived, never sniffed at a call site: it is exactly "coarse, but not mobile",
 * so a device can never be both and never neither. main.tsx mirrors it onto
 * `html.is-tablet` for the CSS gate, the same way it mirrors IS_MOBILE.
 */
export const IS_TABLET = IS_COARSE && !IS_MOBILE;

/**
 * pointerdown handler for a node's read-only chrome and its single-line fields.
 * Desktop: swallow it, so clicking the element doesn't begin a node drag.
 * Mobile: let it bubble, so a canvas pan that happens to start over the element
 * still works (unselected nodes are drag-transparent there anyway, a tap still
 * focuses a field, and form controls are excluded from tap-to-select in Canvas).
 *
 * THIS IS NOT ABOUT PINCH. It used to be — a swallowed pointerdown hid the finger
 * from rete's Zoom handler and killed the gesture, which made every one of these a
 * pinch-blocker. That's fixed positionally instead: the zoom counts fingers in
 * CAPTURE phase now (areaPresets.ts `CappedZoom`), so nothing here can break a
 * two-finger gesture. All this helper decides is the ONE-finger question — does a
 * drag starting on this element pan the canvas, or belong to the element?
 *
 * TABLET (the hybrid case): `IS_MOBILE` is FALSE on a tablet — iPadOS ships a
 * desktop UA by default, and that's deliberate (see IS_MOBILE above), so a tablet
 * swallows exactly like desktop. That is the right answer, not an oversight: a
 * tablet runs the desktop interaction model, where nodes are NOT drag-transparent
 * and a node body is a drag handle. Bubbling there would drag the node out from
 * under a finger that meant to tap a field. Panning on a tablet is the two-finger
 * gesture, which now works over every part of every node.
 *
 * NOT for drag-interactive controls (sliders, dials, the Conduit, group bodies,
 * resize handles) — those need the pointer themselves and keep a hard
 * stopPropagation. Same for `<textarea>`/contenteditable: they own their own scroll
 * and text selection, so a bubbled press there would pan instead of letting the
 * user scroll inside the field.
 *
 * Native-popup controls (`<select>`/`LazySelect`, `<input>` type color/date/file)
 * also keep the hard swallow, but on PRECAUTION, not on a verified mechanism — see
 * subsystem-invariants.md. CLAUDE.md's OS-dropdown rule says a bubbled press
 * re-renders and closes the picker mid-pick; that's widely cited but has no recorded
 * root-cause incident, and the mobile path suggests it may not apply. Nobody has
 * tested it. The upside of converting them is near zero (whether a one-finger pan
 * can START on a small tap target), so it isn't worth the risk of finding out the
 * rule was right. Don't "clean this up" without a real-device check.
 */
export const stopDragStart = (e: { stopPropagation: () => void }) => {
  if (!IS_MOBILE) e.stopPropagation();
};
