// [[C93]] gestureByPointerType. Touch-vs-mouse helpers shared across node chrome.
import { IS_MOBILE_UA } from "./mobileUa";

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

/** THE mobile-mode flag — the single gate for every mobile behavior. main.tsx
 *  mirrors it onto `html.is-mobile` for the CSS gate; derive, never duplicate. */
export const IS_MOBILE = IS_COARSE && IS_MOBILE_UA;

/** THE tablet flag: coarse but NOT mobile, so a device is never both and never
 *  neither. A tablet runs the DESKTOP interaction model, so it gets no mobile
 *  bottom bar — `TabletActions` in the top bar carries those actions instead. */
export const IS_TABLET = IS_COARSE && !IS_MOBILE;

/** pointerdown for a node's read-only chrome and single-line fields: swallowed on
 *  desktop so the click can't begin a node drag, left to bubble on mobile so a pan
 *  starting over the element still works. Decides the ONE-finger question only; the
 *  controls that keep a hard stopPropagation are listed in specs/pointer-gestures.md. */
export const stopDragStart = (e: { stopPropagation: () => void }) => {
  if (!IS_MOBILE) e.stopPropagation();
};
