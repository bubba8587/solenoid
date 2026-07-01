// Touch-vs-mouse helpers shared across node chrome.

/** True when the primary pointer is touch (phone/tablet). Evaluated once. */
export const IS_COARSE =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

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
 * pointerdown handler for a node's read-only chrome and text/number fields.
 * Desktop: swallow it, so clicking the element doesn't begin a node drag.
 * Mobile: let it bubble, so a canvas pan that happens to start over the element
 * still works (unselected nodes are drag-transparent there anyway, a tap still
 * focuses a field, and form controls are excluded from tap-to-select in Canvas).
 *
 * NOT for drag-interactive controls (sliders, dials, the Conduit, group
 * bodies) — those need the pointer themselves and should keep stopPropagation.
 */
export const stopDragStart = (e: { stopPropagation: () => void }) => {
  if (!IS_MOBILE) e.stopPropagation();
};
