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
 * A tablet swallows exactly like desktop (`IS_MOBILE` is false there).
 *
 * It decides the ONE-finger question only — pinch is counted in CAPTURE phase
 * (areaPresets.ts `CappedZoom`) and is unaffected by what this swallows.
 *
 * NOT for drag-interactive controls (sliders, dials, the Conduit, group bodies,
 * resize handles), `<textarea>`/contenteditable, or native-popup controls — all
 * keep a hard stopPropagation. See subsystem-invariants.md before converting any
 * of them.
 */
export const stopDragStart = (e: { stopPropagation: () => void }) => {
  if (!IS_MOBILE) e.stopPropagation();
};
